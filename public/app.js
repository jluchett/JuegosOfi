const socket = io();

// --- SISTEMA DE SONIDO ---
const sonidos = {
    union: document.getElementById('sonido-union'),
    salalista: document.getElementById('sonido-sala-lista'),
    inicioJuego: document.getElementById('sonido-inicio-juego'),
    bombaTick: document.getElementById('sonido-bomba-tick'),
    explosion: document.getElementById('sonido-explosion'),
    semaforoVerde: document.getElementById('sonido-semaforo-verde'),
    victoria: document.getElementById('sonido-victoria'),
    derrota: document.getElementById('sonido-derrota'),
    voto: document.getElementById('sonido-voto'),
    clic: document.getElementById('sonido-clic')
};

let volumenGlobal = 0.5;
let muteado = false;

function ajustarVolumen(valor) {
    volumenGlobal = parseFloat(valor);
    if (!muteado) {
        Object.values(sonidos).forEach(s => { if (s) s.volume = volumenGlobal; });
    }
}

function toggleMute() {
    muteado = !muteado;
    const btn = document.getElementById('btn-mute');
    Object.values(sonidos).forEach(s => { 
        if (s) s.volume = muteado ? 0 : volumenGlobal; 
    });
    btn.innerText = muteado ? '🔊 Activar Sonido' : '🔇 Silenciar';
}

function reproducirSonido(tipo, volumenPersonalizado = 1) {
    if (muteado) return;
    const sonido = sonidos[tipo];
    if (sonido) {
        sonido.volume = volumenGlobal * volumenPersonalizado;
        sonido.currentTime = 0;
        sonido.play().catch(e => console.log('Error reproduciendo sonido:', e));
    }
}

function detenerSonido(tipo) {
    const sonido = sonidos[tipo];
    if (sonido) {
        sonido.pause();
        sonido.currentTime = 0;
    }
}

// 🎵 NUEVA FUNCIÓN: Reproducir en bucle
function reproducirSonidoLoop(tipo, volumenPersonalizado = 1) {
    if (muteado) return;
    const sonido = sonidos[tipo];
    if (sonido) {
        sonido.volume = volumenGlobal * volumenPersonalizado;
        sonido.loop = true;
        sonido.currentTime = 0;
        sonido.play().catch(e => console.log('Error reproduciendo sonido en loop:', e));
    }
}

// 🎵 NUEVA FUNCIÓN: Detener bucle
function detenerSonidoLoop(tipo) {
    const sonido = sonidos[tipo];
    if (sonido) {
        sonido.loop = false;
        sonido.pause();
        sonido.currentTime = 0;
    }
}

// Inicializar volumen
setTimeout(() => {
    Object.values(sonidos).forEach(s => { if (s) s.volume = volumenGlobal; });
}, 100);

// ESTA ES LA CLAVE: El candado que protege la pantalla de login
let jugadorRegistrado = false;

// --- LOBBY ---
function unirse() {
    const nombre = document.getElementById('nombreInput').value.trim();
    if (nombre) {
        reproducirSonido('clic');
        socket.emit('unirse_al_juego', nombre);
    }
}

// Escuchamos la respuesta del servidor
socket.on('ingreso_exitoso', (estado) => {
    jugadorRegistrado = true;
    reproducirSonido('union');
    document.getElementById('pantalla-login').style.display = 'none';
    
    if (estado.juegoEnCurso) {
        const zonaJuego = document.getElementById('pantalla-juego');
        zonaJuego.style.display = 'block';
        zonaJuego.innerHTML = `
            <h2>Juego en curso... 🍿</h2>
            <p style="color: #a5a5b4; margin-top: 20px;">Tus compañeros están sudando en este momento. Espera a que termine la ronda para unirte.</p>
        `;
    } else {
        document.getElementById('pantalla-lobby').style.display = 'block';
    }
});

socket.on('error_nombre', (mensaje) => {
    reproducirSonido('derrota', 0.5);
    alert(mensaje); 
    const input = document.getElementById('nombreInput');
    input.value = ''; 
    input.focus();
});

socket.on('actualizar_lobby', (nombres) => {
    if (!jugadorRegistrado) return;
    const lista = document.getElementById('lista-jugadores');
    lista.innerHTML = '';
    nombres.forEach(nombre => {
        const li = document.createElement('li');
        li.innerText = nombre;
        lista.appendChild(li);
    });
});

// Manejo dinámico de la sala (Mínimo 3 jugadores)
socket.on('sala_lista', () => {
    if (!jugadorRegistrado) return;
    // Detener cualquier reproducción anterior
    detenerSonidoLoop('salalista');
    // Iniciar reproducción en bucle
    reproducirSonidoLoop('salalista');
    document.getElementById('panel-control').style.display = 'block';
    document.getElementById('mensaje-espera').style.display = 'none';
});

socket.on('sala_espera', () => {
    if (!jugadorRegistrado) return;

     // 🎵 DETENER EL BUCLE cuando la sala ya no está lista
    detenerSonidoLoop('salalista');
    
    document.getElementById('panel-control').style.display = 'none';
    const mensajeEspera = document.getElementById('mensaje-espera');
    if(mensajeEspera) mensajeEspera.style.display = 'block';
});

// --- PANEL DE CONTROL ---
function lanzarBomba() { 
    reproducirSonido('inicioJuego');
    socket.emit('lanzar_bomba'); 
}
function lanzarSemaforo() { 
    reproducirSonido('inicioJuego');
    socket.emit('lanzar_semaforo'); 
}
function lanzarImpostor() { 
    reproducirSonido('inicioJuego');
    socket.emit('lanzar_impostor'); 
}
function volverAlLobby() { 
    reproducirSonido('clic');
    socket.emit('regresar_lobby_global'); 
}

// --- ERROR GLOBAL ---
socket.on('error_juego', (mensaje) => {
    reproducirSonido('derrota');
    if (intervaloBomba) clearInterval(intervaloBomba);
    detenerSonido('bombaTick');

    const zonaJuego = document.getElementById('pantalla-juego');
    zonaJuego.innerHTML = `
        <h2 style="color: #f39c12;">¡Partida Interrumpida!</h2>
        <p style="margin: 20px 0;">${mensaje}</p>
    `;
    
    setTimeout(() => {
        volverAlLobby();
    }, 4000);
});

socket.on('mostrar_lobby', () => {
    if (!jugadorRegistrado) return;
    document.getElementById('pantalla-juego').style.display = 'none';
    document.getElementById('pantalla-juego').innerHTML = ''; 
    document.getElementById('pantalla-lobby').style.display = 'block';
    document.body.style.backgroundColor = "var(--fondo-oscuro)"; 
});

function generarBotonVolver() {
    return `<br><button onclick="volverAlLobby()" style="margin-top: 30px; background-color: #3d3d5c;">Volver al Panel</button>`;
}

// --- JUEGO 1: LA BOMBA ---
let intervaloBomba;

socket.on('iniciar_juego_bomba', () => {
    if (!jugadorRegistrado) return;
    reproducirSonido('inicioJuego');
    
    document.getElementById('pantalla-lobby').style.display = 'none';
    const zonaJuego = document.getElementById('pantalla-juego');
    zonaJuego.style.display = 'block';
    
    let contador = 5;
    zonaJuego.innerHTML = `
        <h2>¡La bomba está a punto de explotar!</h2>
        <div id="contador-bomba" style="font-size: 100px; color: #ff4757; font-weight: bold; margin: 40px 0; transition: transform 0.1s;">
            ${contador}
        </div>
        <p style="color: #a5a5b4;">Alguien será elegido al azar...</p>
    `;

    // Sonido de tick inicial
    reproducirSonido('bombaTick', 0.6);

    intervaloBomba = setInterval(() => {
        contador--;
        const contElement = document.getElementById('contador-bomba');
        if (contElement) {
            contElement.innerText = contador;
            contElement.style.transform = 'scale(1.3)';
            setTimeout(() => contElement.style.transform = 'scale(1)', 150);
        }
        
        // Sonido de tick en cada segundo
        if (contador > 0) {
            reproducirSonido('bombaTick', 0.6);
        }
        
        if (contador <= 0) {
            clearInterval(intervaloBomba);
            detenerSonido('bombaTick');
        }
    }, 1000);
});

socket.on('fin_juego_bomba', (nombrePerdedor) => {
    if (!jugadorRegistrado) return;
    clearInterval(intervaloBomba);
    detenerSonido('bombaTick');
    reproducirSonido('explosion');
    
    const zonaJuego = document.getElementById('pantalla-juego');
    const miNombre = document.getElementById('nombreInput').value;

    if (miNombre === nombrePerdedor) {
        zonaJuego.innerHTML = `<h1 style="color: #ff4757; font-size: 50px;">¡BOOOM!</h1><h2>¡Explotaste, ${nombrePerdedor}!</h2>`;
        document.body.style.backgroundColor = "#ff4757"; 
        reproducirSonido('derrota');
    } else {
        zonaJuego.innerHTML = `<h1 style="color: #2ed573;">¡Te salvaste!</h1><h2>Explotó: <span style="color:#ff4757;">${nombrePerdedor}</span></h2>`;
        reproducirSonido('victoria');
    }
    setTimeout(() => zonaJuego.innerHTML += generarBotonVolver(), 3000);
});

// --- JUEGO 2: EL SEMÁFORO ---
socket.on('preparar_semaforo', () => {
    if (!jugadorRegistrado) return;
    reproducirSonido('inicioJuego');
    
    document.getElementById('pantalla-lobby').style.display = 'none';
    const zonaJuego = document.getElementById('pantalla-juego');
    zonaJuego.style.display = 'block';
    zonaJuego.innerHTML = `
        <h2>¡Espera el Verde!</h2>
        <p>El último pierde. Si haces clic en rojo, pierdes directo.</p>
        <div id="caja-semaforo" onclick="presionarSemaforo()">ESPERA...</div>
    `;
    document.body.style.backgroundColor = "var(--fondo-oscuro)";
});

socket.on('semaforo_verde', () => {
    if (!jugadorRegistrado) return;
    reproducirSonido('semaforoVerde');
    
    const caja = document.getElementById('caja-semaforo');
    if(caja) {
        caja.classList.add('semaforo-verde');
        caja.innerText = "¡DALE CLIC!";
    }
});

function presionarSemaforo() {
    reproducirSonido('clic');
    socket.emit('clic_semaforo');
    const caja = document.getElementById('caja-semaforo');
    if(caja) {
        caja.innerText = "Registrado...";
        caja.style.opacity = "0.5";
    }
}

socket.on('fin_juego_semaforo', (datos) => {
    if (!jugadorRegistrado) return;
    const zonaJuego = document.getElementById('pantalla-juego');
    const miNombre = document.getElementById('nombreInput').value;

    if (miNombre === datos.perdedor) {
        zonaJuego.innerHTML = `<h1 style="color: #ff4757; font-size: 50px;">¡FUISTE EL MÁS LENTO!</h1><h2>Tiempo: ${datos.tiempo}</h2>`;
        document.body.style.backgroundColor = "#ff4757"; 
        reproducirSonido('derrota');
    } else {
        zonaJuego.innerHTML = `<h1 style="color: #2ed573;">¡Qué reflejos!</h1><h2>Perdedor: <span style="color:#ff4757;">${datos.perdedor}</span></h2><p>Tiempo: ${datos.tiempo}</p>`;
        reproducirSonido('victoria');
    }
    setTimeout(() => zonaJuego.innerHTML += generarBotonVolver(), 3000);
});

// --- JUEGO 3: EL IMPOSTOR ---
socket.on('iniciar_juego_impostor', (datos) => {
    if (!jugadorRegistrado) return;
    reproducirSonido('inicioJuego');

    document.getElementById('pantalla-lobby').style.display = 'none';
    const zonaJuego = document.getElementById('pantalla-juego');
    zonaJuego.style.display = 'block';
    
    const clasePalabra = datos.esImpostor ? "palabra-impostor" : "palabra-secreta";
    const textoAyuda = datos.esImpostor ? "Imita a los demás. ¡Que no te descubran!" : "Dí una palabra relacionada. Descubre quién miente.";

    let botonesVoto = "";
    for (let id in datos.listaJugadores) {
        if (id !== datos.miId) {
            botonesVoto += `<button id="btn-${id}" class="btn-voto" onclick="enviarVoto('${id}')">Votar por ${datos.listaJugadores[id]}</button>`;
        }
    }

    const totalJugadores = Object.keys(datos.listaJugadores).length;

    zonaJuego.innerHTML = `
        <h2>Ronda de Engaños</h2>
        <div class="tarjeta-rol">
            <p>Tu palabra es:</p>
            <div class="${clasePalabra}">${datos.palabra}</div>
            <p style="font-size: 14px; color: #a5a5b4;">${textoAyuda}</p>
        </div>
        <div id="zona-votacion" style="margin-top: 30px;">
            <h3>¿Quién es el impostor?</h3>
            ${botonesVoto}
        </div>
        <div id="estado-votos" class="esperando-votos">Esperando votos... (0/${totalJugadores})</div>
    `;
    document.body.style.backgroundColor = "var(--fondo-oscuro)";
});

socket.on('jugador_fugitivo', (idFugitivo) => {
    if (!jugadorRegistrado) return;
    
    const btn = document.getElementById(`btn-${idFugitivo}`);
    if (btn) {
        btn.disabled = true;
        btn.innerText += " (Huyó)";
        btn.style.backgroundColor = "#555";
        btn.style.textDecoration = "line-through";
        btn.style.cursor = "not-allowed";
        btn.style.borderLeft = "5px solid #555";
    }
});

function enviarVoto(idVotado) {
    reproducirSonido('voto');
    socket.emit('votar_impostor', idVotado);
    document.getElementById('zona-votacion').innerHTML = "<h3>Voto registrado.</h3><p>Esperando al resto...</p>";
}

socket.on('actualizar_conteo_votos', (datosVotos) => {
    if (!jugadorRegistrado) return;
    const estado = document.getElementById('estado-votos');
    if (estado) estado.innerText = `Esperando votos... (${datosVotos.actuales}/${datosVotos.total})`;
});

socket.on('fin_juego_impostor', (resultados) => {
    if (!jugadorRegistrado) return;
    const zonaJuego = document.getElementById('pantalla-juego');
    const miNombre = document.getElementById('nombreInput').value;
    
    const esEmpate = (resultados.nombrePerdedor === "Empate");
    const esPerdedor = (miNombre === resultados.nombrePerdedor && !esEmpate);

    document.body.style.backgroundColor = esPerdedor ? "#ff4757" : "var(--fondo-oscuro)";

    const colorBorde = esPerdedor ? 'white' : (esEmpate ? '#a5a5b4' : '#ff4757');
    const colorTexto = esPerdedor ? 'white' : (esEmpate ? '#a5a5b4' : '#ff4757');
    const tituloTarjeta = esEmpate ? "RESULTADO:" : "EXPULSADO:";

    // Sonido según resultado
    if (esPerdedor) {
        reproducirSonido('derrota');
    } else if (!esEmpate) {
        reproducirSonido('victoria');
    }

    zonaJuego.innerHTML = `
        <h1 style="color: ${esPerdedor ? 'white' : '#8e44ad'};">${resultados.titulo}</h1>
        <h2>El Impostor era: <span style="color:#f39c12;">${resultados.nombreImpostor}</span></h2>
        <div class="tarjeta-rol" style="border-color: ${colorBorde};">
            <h3>${tituloTarjeta}</h3>
            <p style="font-size: 30px; font-weight: bold; color: ${colorTexto};">${resultados.nombrePerdedor}</p>
        </div>
    `;
    setTimeout(() => zonaJuego.innerHTML += generarBotonVolver(), 4000);
});