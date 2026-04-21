const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use('/sounds', express.static('sounds'));

let jugadores = {}; 
let jugadoresJugando = {}; 
let nombresRonda = {};

// 🏆 SISTEMA DE PUNTUACIÓN
let puntuaciones = {}; // { nombre: puntuacionTotal }

let juegoActual = null; 

let tiemposReaccion = {};
let tiempoInicioVerde = 0;
let semaforoActivo = false;

let votosImpostor = {};
let impostorActualId = null;
const listaPalabras = ["Cafetera", "Impresora", "Salario", "Vacaciones", "Jefe", "Viernes", "Microondas", "Reunión", "Teclado", "Audífonos"];

// 🏆 PUNTUACIONES POR JUEGO
const PUNTOS = {
    BOMBA_SUPERVIVIENTE: 50,
    BOMBA_EXPLOTA: -30,
    SEMAFORO_GANADOR: 40,
    SEMAFORO_PERDEDOR: -20,
    SEMAFORO_CLIC_ANTES: -50,
    IMPOSTOR_GANA: 100,
    IMPOSTOR_PIERDE: -50,
    INOCENTE_ACIERTA: 60,
    INOCENTE_FALLA: -20
};

// 🗂️ JUEGO 5: ENCUENTRA EL EXPEDIENTE
let rondaExpediente = 1;
const TOTAL_RONDAS = 5;
let puntuacionesExpediente = {};
let esperandoRespuestas = false;
let timeoutExpediente = null;

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    function verificarEstadoSala() {
        if (Object.keys(jugadores).length >= 3) {
            io.emit('sala_lista');
        } else {
            io.emit('sala_espera');
        }
    }

    // 🏆 Función para actualizar puntuación
    function actualizarPuntuacion(nombre, puntos) {
        if (!puntuaciones[nombre]) puntuaciones[nombre] = 0;
        puntuaciones[nombre] += puntos;
        
        // Enviar ranking actualizado a todos
        io.emit('actualizar_ranking', obtenerRanking());
    }

    // 🏆 Función para obtener ranking ordenado
    function obtenerRanking() {
        return Object.entries(puntuaciones)
            .sort(([, a], [, b]) => b - a)
            .map(([nombre, puntos]) => ({ nombre, puntos }));
    }

    socket.on('unirse_al_juego', (nombre) => {
        const nombresActuales = Object.values(jugadores).map(n => n.toLowerCase());
        
        if (nombresActuales.includes(nombre.toLowerCase())) {
            socket.emit('error_nombre', 'Ese nombre ya está en uso. ¡Elige otro!');
            return; 
        }

        jugadores[socket.id] = nombre;
        
        // 🏆 Inicializar puntuación si es nuevo
        if (!puntuaciones[nombre]) {
            puntuaciones[nombre] = 0;
        }
        
        socket.emit('ingreso_exitoso', { 
            juegoEnCurso: juegoActual !== null,
            ranking: obtenerRanking() // Enviar ranking inicial
        }); 
        io.emit('actualizar_lobby', Object.values(jugadores));
        io.emit('actualizar_ranking', obtenerRanking()); // Enviar ranking a todos
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
        nombresRonda = { ...jugadores };
        
        io.emit('iniciar_juego_bomba'); 

        setTimeout(() => {
            const idsJugadores = Object.keys(jugadoresJugando);
            if (idsJugadores.length > 0 && juegoActual === "bomba") {
                juegoActual = null; 
                const perdedorId = idsJugadores[Math.floor(Math.random() * idsJugadores.length)];
                const nombrePerdedor = nombresRonda[perdedorId];
                
                // 🏆 Otorgar puntos
                idsJugadores.forEach(id => {
                    const nombre = nombresRonda[id];
                    if (id === perdedorId) {
                        actualizarPuntuacion(nombre, PUNTOS.BOMBA_EXPLOTA);
                    } else {
                        actualizarPuntuacion(nombre, PUNTOS.BOMBA_SUPERVIVIENTE);
                    }
                });
                
                io.emit('fin_juego_bomba', {
                    perdedor: nombrePerdedor,
                    puntuaciones: obtenerRanking()
                });
                
                setTimeout(() => verificarEstadoSala(), 100);
            }
        }, 5000);
    });

    socket.on('lanzar_semaforo', () => {
        if (juegoActual !== null || Object.keys(jugadores).length < 3) return;
        juegoActual = "semaforo";
        jugadoresJugando = { ...jugadores }; 
        nombresRonda = { ...jugadores };

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
            let idPerdedor = null;

            for (let id in tiemposReaccion) {
                if (tiemposReaccion[id] > tiempoMaximo) {
                    tiempoMaximo = tiemposReaccion[id];
                    elMasLento = nombresRonda[id];
                    idPerdedor = id;
                }
            }

            // 🏆 Otorgar puntos
            Object.keys(jugadoresJugando).forEach(id => {
                const nombre = nombresRonda[id];
                if (id === idPerdedor) {
                    const puntosPerdida = tiempoMaximo === 99999 ? 
                        PUNTOS.SEMAFORO_CLIC_ANTES : PUNTOS.SEMAFORO_PERDEDOR;
                    actualizarPuntuacion(nombre, puntosPerdida);
                } else {
                    actualizarPuntuacion(nombre, PUNTOS.SEMAFORO_GANADOR);
                }
            });

            io.emit('fin_juego_semaforo', {
                perdedor: elMasLento,
                tiempo: tiempoMaximo === 99999 ? "¡HIZO CLIC ANTES DE TIEMPO!" : `${tiempoMaximo} ms`,
                puntuaciones: obtenerRanking()
            });
            
            setTimeout(() => verificarEstadoSala(), 100);
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
            let impostorGana = false;

            if (huboEmpate) {
                perdedorId = "Nadie";
                titulo = "¡EMPATE! EL IMPOSTOR SOBREVIVE";
                impostorGana = true;
            } else if (masVotadoId === impostorActualId) {
                perdedorId = impostorActualId;
                titulo = "¡LA OFICINA GANÓ!";
                impostorGana = false;
            } else {
                perdedorId = masVotadoId;
                titulo = "¡EL IMPOSTOR LOS ENGAÑÓ!";
                impostorGana = true;
            }

            // 🏆 Otorgar puntos
            Object.keys(jugadoresJugando).forEach(id => {
                const nombre = nombresRonda[id];
                const esImpostor = (id === impostorActualId);
                
                if (huboEmpate) {
                    // En empate, el impostor gana puntos reducidos, inocentes no pierden
                    if (esImpostor) {
                        actualizarPuntuacion(nombre, 30);
                    }
                } else if (esImpostor) {
                    // Impostor
                    if (impostorGana) {
                        actualizarPuntuacion(nombre, PUNTOS.IMPOSTOR_GANA);
                    } else {
                        actualizarPuntuacion(nombre, PUNTOS.IMPOSTOR_PIERDE);
                    }
                } else {
                    // Inocentes
                    if (!impostorGana) {
                        actualizarPuntuacion(nombre, PUNTOS.INOCENTE_ACIERTA);
                    } else {
                        actualizarPuntuacion(nombre, PUNTOS.INOCENTE_FALLA);
                    }
                }
            });

            io.emit('fin_juego_impostor', {
                titulo: titulo,
                nombrePerdedor: huboEmpate ? "Empate" : nombresRonda[perdedorId],
                nombreImpostor: nombresRonda[impostorActualId],
                puntuaciones: obtenerRanking()
            });
            
            setTimeout(() => verificarEstadoSala(), 100);
        }
    }

    socket.on('lanzar_impostor', () => {
        if (juegoActual !== null || Object.keys(jugadores).length < 3) return; 
        juegoActual = "impostor";      
        jugadoresJugando = { ...jugadores }; 
        nombresRonda = { ...jugadores };

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
    
    socket.on('lanzar_expediente', () => {
        if (juegoActual !== null || Object.keys(jugadores).length < 2) return;
        
        juegoActual = "expediente";
        jugadoresJugando = { ...jugadores };
        nombresRonda = { ...jugadores };
        rondaExpediente = 1;
        puntuacionesExpediente = {};
        
        Object.keys(jugadoresJugando).forEach(id => {
            puntuacionesExpediente[id] = 0;
        });
        
        io.emit('iniciar_expediente', { 
            ronda: rondaExpediente, 
            totalRondas: TOTAL_RONDAS 
        });
        
        iniciarRondaExpediente();
    });

    function iniciarRondaExpediente() {
        if (juegoActual !== "expediente") return;
        
        esperandoRespuestas = true;
        
        // Generar número de expediente aleatorio (1-9)
        const numeroExpediente = Math.floor(Math.random() * 9) + 1;
        
        io.emit('nueva_ronda_expediente', {
            ronda: rondaExpediente,
            numero: numeroExpediente
        });
        
        // Timeout para la ronda (3 segundos)
        timeoutExpediente = setTimeout(() => {
            finalizarRondaExpediente(null);
        }, 3000);
    }

    function finalizarRondaExpediente(ganadorId) {
        if (juegoActual !== "expediente") return;
        
        clearTimeout(timeoutExpediente);
        esperandoRespuestas = false;
        
        if (ganadorId) {
            puntuacionesExpediente[ganadorId] += 1;
            
            io.emit('resultado_ronda_expediente', {
                ganador: nombresRonda[ganadorId],
                puntos: puntuacionesExpediente
            });
        } else {
            io.emit('resultado_ronda_expediente', {
                ganador: null,
                puntos: puntuacionesExpediente
            });
        }
        
        rondaExpediente++;
        
        if (rondaExpediente <= TOTAL_RONDAS) {
            setTimeout(() => {
                io.emit('iniciar_expediente', { 
                    ronda: rondaExpediente, 
                    totalRondas: TOTAL_RONDAS 
                });
                iniciarRondaExpediente();
            }, 2000);
        } else {
            finalizarJuegoExpediente();
        }
    }

    function finalizarJuegoExpediente() {
        juegoActual = null;
        
        // Determinar ganador
        let maxPuntos = -1;
        let ganadorId = null;
        
        for (let id in puntuacionesExpediente) {
            if (puntuacionesExpediente[id] > maxPuntos) {
                maxPuntos = puntuacionesExpediente[id];
                ganadorId = id;
            }
        }
        
        // Otorgar puntos
        Object.keys(jugadoresJugando).forEach(id => {
            const nombre = nombresRonda[id];
            if (id === ganadorId) {
                actualizarPuntuacion(nombre, 50);
            } else {
                actualizarPuntuacion(nombre, 10);
            }
        });
        
        io.emit('fin_expediente', {
            ganador: ganadorId ? nombresRonda[ganadorId] : "Nadie",
            puntuacionesRonda: puntuacionesExpediente,
            ranking: obtenerRanking()
        });
        
        setTimeout(() => verificarEstadoSala(), 100);
    }

    socket.on('click_expediente', (numeroClickeado) => {
        if (!esperandoRespuestas || !jugadoresJugando[socket.id]) return;
        if (juegoActual !== "expediente") return;
        
        const numeroCorrecto = numeroExpedienteActual;
        
        if (numeroClickeado === numeroCorrecto) {
            finalizarRondaExpediente(socket.id);
        }
    });

    // Variable para guardar el número actual
    let numeroExpedienteActual = 0;

    // Actualizar la función iniciarRondaExpediente
    const originalIniciarRonda = iniciarRondaExpediente;
    iniciarRondaExpediente = function() {
        if (juegoActual !== "expediente") return;
        
        esperandoRespuestas = true;
        numeroExpedienteActual = Math.floor(Math.random() * 9) + 1;
        
        io.emit('nueva_ronda_expediente', {
            ronda: rondaExpediente,
            numero: numeroExpedienteActual
        });
        
        timeoutExpediente = setTimeout(() => {
            finalizarRondaExpediente(null);
        }, 3000);
    };
        
    // 🏆 Endpoint para resetear puntuaciones (opcional)
    socket.on('resetear_puntuaciones', () => {
        puntuaciones = {};
        Object.values(jugadores).forEach(nombre => {
            puntuaciones[nombre] = 0;
        });
        io.emit('actualizar_ranking', obtenerRanking());
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});