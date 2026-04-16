const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use('/sounds', express.static('sounds')); // 🎵 AÑADE ESTA LÍNEA

let jugadores = {}; 
let jugadoresJugando = {}; 
let nombresRonda = {}; // 🚨 MEJORA: Caja fuerte para evitar los "undefined"

let juegoActual = null; 

let tiemposReaccion = {};
let tiempoInicioVerde = 0;
let semaforoActivo = false;

let votosImpostor = {};
let impostorActualId = null;
const listaPalabras = ["Cafetera", "Impresora", "Salario", "Vacaciones", "Jefe", "Viernes", "Microondas", "Reunión", "Teclado", "Audífonos"];

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    function verificarEstadoSala() {
        if (Object.keys(jugadores).length >= 3) {
            io.emit('sala_lista');
        } else {
            io.emit('sala_espera');
        }
    }

    socket.on('unirse_al_juego', (nombre) => {
        const nombresActuales = Object.values(jugadores).map(n => n.toLowerCase());
        
        if (nombresActuales.includes(nombre.toLowerCase())) {
            socket.emit('error_nombre', 'Ese nombre ya está en uso. ¡Elige otro!');
            return; 
        }

        jugadores[socket.id] = nombre;
        socket.emit('ingreso_exitoso', { juegoEnCurso: juegoActual !== null }); 
        io.emit('actualizar_lobby', Object.values(jugadores));
        verificarEstadoSala();
    });

    socket.on('disconnect', () => {
        const nombreDesconectado = jugadores[socket.id];
        const fueImpostor = (socket.id === impostorActualId);

        delete jugadores[socket.id];
        delete jugadoresJugando[socket.id];
        
        io.emit('actualizar_lobby', Object.values(jugadores));
        verificarEstadoSala();

        if (juegoActual !== null) {
            if (Object.keys(jugadoresJugando).length < 3) {
                juegoActual = null; 
                io.emit('error_juego', "Se han desconectado demasiados jugadores. Regresando al lobby...");
                return;
            }

            if (juegoActual === "impostor") {
                if (fueImpostor) {
                    juegoActual = null;
                    impostorActualId = null;
                    io.emit('error_juego', `El impostor (${nombresRonda[socket.id] || nombreDesconectado}) huyó de la oficina. Partida cancelada.`);
                    return;
                }
                
                // 🚨 MEJORA: Avisamos a los clientes que un inocente huyó
                io.emit('jugador_fugitivo', socket.id);
                verificarFinVotacion();
                
            } else if (juegoActual === "semaforo") {
                verificarFinSemaforo();
            }
        }
    });

    socket.on('regresar_lobby_global', () => {
        juegoActual = null; 
        io.emit('mostrar_lobby');
    });

    socket.on('lanzar_bomba', () => {
        if (juegoActual !== null || Object.keys(jugadores).length < 3) return;
        juegoActual = "bomba"; 
        jugadoresJugando = { ...jugadores }; 
        nombresRonda = { ...jugadores }; // Tomamos la foto permanente
        
        io.emit('iniciar_juego_bomba'); 

        setTimeout(() => {
            const idsJugadores = Object.keys(jugadoresJugando);
            if (idsJugadores.length > 0 && juegoActual === "bomba") {
                juegoActual = null; 
                const perdedorId = idsJugadores[Math.floor(Math.random() * idsJugadores.length)];
                io.emit('fin_juego_bomba', nombresRonda[perdedorId]); // Usamos caja fuerte
            }
        }, 5000);
    });

    socket.on('lanzar_semaforo', () => {
        if (juegoActual !== null || Object.keys(jugadores).length < 3) return;
        juegoActual = "semaforo";
        jugadoresJugando = { ...jugadores }; 
        nombresRonda = { ...jugadores }; // Tomamos la foto permanente

        tiemposReaccion = {};
        tiempoInicioVerde = 0;
        semaforoActivo = true;
        io.emit('preparar_semaforo'); 

        const tiempoEspera = Math.floor(Math.random() * 5000) + 3000;
        setTimeout(() => {
            if(semaforoActivo && juegoActual === "semaforo") {
                tiempoInicioVerde = Date.now();
                io.emit('semaforo_verde'); 
            }
        }, tiempoEspera);
    });

    socket.on('clic_semaforo', () => {
        if (!semaforoActivo || !jugadoresJugando[socket.id]) return; 

        if (tiempoInicioVerde === 0) {
            tiemposReaccion[socket.id] = 99999; 
        } else if (!tiemposReaccion[socket.id]) {
            tiemposReaccion[socket.id] = Date.now() - tiempoInicioVerde;
        }

        verificarFinSemaforo();
    });

    function verificarFinSemaforo() {
        if (juegoActual !== "semaforo") return; 

        for (let id in tiemposReaccion) {
            if (!jugadoresJugando[id]) delete tiemposReaccion[id];
        }

        if (Object.keys(tiemposReaccion).length === Object.keys(jugadoresJugando).length && Object.keys(jugadoresJugando).length > 0) {
            juegoActual = null; 
            semaforoActivo = false;
            
            let elMasLento = null;
            let tiempoMaximo = -1;

            for (let id in tiemposReaccion) {
                if (tiemposReaccion[id] > tiempoMaximo) {
                    tiempoMaximo = tiemposReaccion[id];
                    elMasLento = nombresRonda[id]; // Usamos caja fuerte
                }
            }

            io.emit('fin_juego_semaforo', {
                perdedor: elMasLento,
                tiempo: tiempoMaximo === 99999 ? "¡HIZO CLIC ANTES DE TIEMPO!" : `${tiempoMaximo} ms`
            });
        }
    }

    function verificarFinVotacion() {
        if (juegoActual !== "impostor" || Object.keys(votosImpostor).length === 0) return;

        for (let id in votosImpostor) {
            if (!jugadoresJugando[id]) delete votosImpostor[id];
        }

        const totalJugadores = Object.keys(jugadoresJugando).length; 
        const totalVotos = Object.keys(votosImpostor).length;

        io.emit('actualizar_conteo_votos', { actuales: totalVotos, total: totalJugadores });

        if (totalVotos >= totalJugadores && totalJugadores > 0) {
            juegoActual = null; 
            let conteo = {};
            for (let votante in votosImpostor) {
                let votado = votosImpostor[votante];
                conteo[votado] = (conteo[votado] || 0) + 1;
            }

            let maxVotos = 0;
            let masVotadoId = null;
            let huboEmpate = false;

            for (let id in conteo) {
                if (conteo[id] > maxVotos) {
                    maxVotos = conteo[id];
                    masVotadoId = id;
                    huboEmpate = false;
                } else if (conteo[id] === maxVotos) {
                    huboEmpate = true;
                }
            }

            let perdedorId = null;
            let titulo = "";

            if (huboEmpate) {
                perdedorId = "Nadie";
                titulo = "¡EMPATE! EL IMPOSTOR SOBREVIVE";
            } else if (masVotadoId === impostorActualId) {
                perdedorId = impostorActualId;
                titulo = "¡LA OFICINA GANÓ!";
            } else {
                perdedorId = masVotadoId;
                titulo = "¡EL IMPOSTOR LOS ENGAÑÓ!";
            }

            io.emit('fin_juego_impostor', {
                titulo: titulo,
                // 🚨 MEJORA: Usamos la caja fuerte para evitar el "undefined"
                nombrePerdedor: huboEmpate ? "Empate" : nombresRonda[perdedorId],
                nombreImpostor: nombresRonda[impostorActualId] 
            });
        }
    }

    socket.on('lanzar_impostor', () => {
        if (juegoActual !== null || Object.keys(jugadores).length < 3) return; 
        juegoActual = "impostor";      
        jugadoresJugando = { ...jugadores }; 
        nombresRonda = { ...jugadores }; // Tomamos la foto permanente

        votosImpostor = {};
        const palabraSecreta = listaPalabras[Math.floor(Math.random() * listaPalabras.length)];
        const idsJugadores = Object.keys(jugadoresJugando);
        impostorActualId = idsJugadores[Math.floor(Math.random() * idsJugadores.length)];

        idsJugadores.forEach(id => {
            const esImpostor = (id === impostorActualId);
            io.to(id).emit('iniciar_juego_impostor', {
                esImpostor: esImpostor,
                palabra: esImpostor ? "ERES EL IMPOSTOR" : palabraSecreta,
                listaJugadores: jugadoresJugando,
                miId: id
            });
        });
    });

    socket.on('votar_impostor', (idVotado) => {
        if(!jugadoresJugando[socket.id]) return; 
        votosImpostor[socket.id] = idVotado;
        verificarFinVotacion();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});