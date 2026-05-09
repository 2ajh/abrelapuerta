const PROXY_URL = "/api";

let currentPin     = "";
let isProcessing   = false;
let countdownTimer = null;
let gateInterval   = null;
let gpsGranted     = false;

// ── GPS indicator ──────────────────────────────────────────────────────────────
function initGPS() {
    const el = document.getElementById('gps-indicator');

    if (!navigator.geolocation) {
        setGPS('inactive', '❌ GPS no disponible');
        return;
    }

    setGPS('checking', '⏳ Comprobando ubicación...');

    navigator.permissions.query({ name: 'geolocation' }).then(result => {
        if (result.state === 'granted') {
            setGPS('active', '✅ Ubicación activada');
            gpsGranted = true;
        } else if (result.state === 'denied') {
            setGPS('inactive', '❌ Ubicación denegada — pulsa para activar');
            gpsGranted = false;
        } else {
            // 'prompt' — no se sabe todavía
            setGPS('inactive', '📍 Pulsa para activar ubicación');
            gpsGranted = false;
        }

        result.onchange = () => {
            if (result.state === 'granted') {
                setGPS('active', '✅ Ubicación activada');
                gpsGranted = true;
            } else {
                setGPS('inactive', '❌ Ubicación denegada — pulsa para activar');
                gpsGranted = false;
            }
        };
    }).catch(() => {
        // Navegador no soporta permissions API (algunos Android)
        setGPS('inactive', '📍 Pulsa para activar ubicación');
    });
}

function setGPS(state, text) {
    const el = document.getElementById('gps-indicator');
    el.className = `gps-indicator ${state}`;
    el.id = 'gps-indicator';
    el.innerText = text;
}

function requestGPS() {
    if (gpsGranted) return; // ya está activo, no hace nada
    setGPS('checking', '⏳ Solicitando ubicación...');
    navigator.geolocation.getCurrentPosition(
        () => { setGPS('active', '✅ Ubicación activada'); gpsGranted = true; },
        ()  => { setGPS('inactive', '❌ Ubicación denegada — actívala en ajustes'); gpsGranted = false; },
        { timeout: 8000 }
    );
}

// ── Teclado ────────────────────────────────────────────────────────────────────
function press(n) {
    if (isProcessing || currentPin.length >= 6) return;
    currentPin += n;
    updateDisplay();
    resetMsg();
}
function clearPin()   { currentPin = ""; updateDisplay(); resetMsg(); }
function deleteLast() { currentPin = currentPin.slice(0, -1); updateDisplay(); resetMsg(); }
function resetMsg()   { setMsg("Introduce tu PIN de acceso", ""); }

function updateDisplay() {
    document.getElementById('display').innerText = "•".repeat(currentPin.length);
}

function setMsg(text, cls) {
    const el = document.getElementById('status-msg');
    el.innerText = text;
    el.className = cls;
}

// ── Paneles ────────────────────────────────────────────────────────────────────
function showOnly(id) {
    ['pin-interface','spinner-box','door-box','result-box','countdown-box']
        .forEach(boxId => {
            const el = document.getElementById(boxId);
            if (boxId !== id) { el.style.display = 'none'; return; }
            el.style.display = (boxId === 'spinner-box' || boxId === 'door-box') ? 'flex' : 'block';
        });
}

// ── Flujo principal ────────────────────────────────────────────────────────────
async function validate() {
    if (currentPin.length < 4 || isProcessing) return;

    isProcessing = true;
    document.getElementById('btn-send').disabled = true;
    setMsg("OBTENIENDO UBICACIÓN...", "");

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            showOnly('spinner-box');
            setSpinner("ENVIANDO...");
            setMsg("", "");
            setGPS('active', '✅ Ubicación activada');
            gpsGranted = true;

            let requestId;
            try {
                const res  = await fetch(`${PROXY_URL}/trigger`, {
                    method:  "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        pin: currentPin,
                        lat: pos.coords.latitude,
                        lon: pos.coords.longitude,
                    }),
                });
                const data = await res.json();
                if (!res.ok || !data.requestId) {
                    showError("ERROR DE CONEXIÓN", "No se pudo contactar con el servidor");
                    return;
                }
                requestId = data.requestId;
            } catch {
                showError("ERROR DE CONEXIÓN", "Comprueba tu conexión a internet");
                return;
            }

            setSpinner("VERIFICANDO PIN...");
            try {
                const res    = await fetch(`${PROXY_URL}/result/${requestId}`);
                const result = await res.json();
                handleResult(result.status);
            } catch {
                showError("SIN RESPUESTA", "El sistema no respondió a tiempo");
            }
        },
        (err) => {
            if (err.code === 1) {
                setMsg("PERMISO DE GPS DENEGADO", "error");
                setGPS('inactive', '❌ Ubicación denegada — pulsa aquí para activarla');
                gpsGranted = false;
            } else {
                setMsg("ACTIVA EL GPS", "error");
                setGPS('inactive', '📍 Pulsa para activar ubicación');
            }
            resetProcessing();
        },
        { timeout: 8000, maximumAge: 10000 }
    );
}

function setSpinner(text) {
    document.getElementById('spinner-label').innerText = text;
}

function handleResult(status) {
    switch (status) {
        case "granted":   animarApertura(); break;
        case "wrong_pin": showError("ACCESO DENEGADO",   "PIN incorrecto",                          "red");   break;
        case "too_far":   showError("DEMASIADO LEJOS",   "Debes estar cerca del portón para abrirlo", "warn"); break;
        case "timeout":   showError("SIN RESPUESTA",     "El sistema tardó demasiado en responder", "muted"); break;
        default:          showError("ERROR",              "Inténtalo de nuevo",                       "muted"); break;
    }
}

// ── Animación apertura ─────────────────────────────────────────────────────────
function animarApertura() {
    const wrapper = document.getElementById('gate-wrapper');
    wrapper.classList.remove('closing');

    showOnly('door-box');
    document.getElementById('header').innerText     = "PROCESANDO";
    document.getElementById('door-label').innerText = "ABRIENDO PORTÓN...";
    setMsg("", "");

    let progress = 0;
    const gateLeft    = document.getElementById('gate-left');
    const gateRight   = document.getElementById('gate-right');
    const percentText = document.getElementById('door-percent');

    gateLeft.style.transform  = 'translateX(0%)';
    gateRight.style.transform = 'translateX(0%)';
    percentText.innerText = "0%";

    gateInterval = setInterval(() => {
        progress++;
        gateLeft.style.transform  = `translateX(-${progress}%)`;
        gateRight.style.transform = `translateX(${progress}%)`;
        percentText.innerText = progress + "%";

        if (progress >= 100) {
            clearInterval(gateInterval);
            gateInterval = null;
            setTimeout(() => iniciarCuentaAtras(), 400);
        }
    }, 100);
}

// ── Animación cierre ───────────────────────────────────────────────────────────
function animarCierre(callback) {
    const wrapper = document.getElementById('gate-wrapper');
    wrapper.classList.add('closing');

    showOnly('door-box');
    document.getElementById('header').innerText     = "CERRANDO";
    document.getElementById('door-label').innerText = "CERRANDO PORTÓN...";
    setMsg("", "");

    let progress = 100;
    const gateLeft    = document.getElementById('gate-left');
    const gateRight   = document.getElementById('gate-right');
    const percentText = document.getElementById('door-percent');

    // Las puertas empiezan abiertas
    gateLeft.style.transform  = 'translateX(-100%)';
    gateRight.style.transform = 'translateX(100%)';
    percentText.innerText = "100%";

    gateInterval = setInterval(() => {
        progress--;
        gateLeft.style.transform  = `translateX(-${progress}%)`;
        gateRight.style.transform = `translateX(${progress}%)`;
        percentText.innerText = progress + "%";

        if (progress <= 0) {
            clearInterval(gateInterval);
            gateInterval = null;
            setTimeout(() => {
                document.getElementById('explosion').classList.add('boom-active');
                setTimeout(() => callback(), 1200);
            }, 300);
        }
    }, 100);
}

// ── Error ──────────────────────────────────────────────────────────────────────
function showError(title, sub, iconClass = "red") {
    document.getElementById('header').innerText        = title === "ACCESO DENEGADO" ? "ACCESO DENEGADO" : "ERROR";
    document.getElementById('result-title').innerText  = title;
    document.getElementById('result-title').style.color =
        iconClass === "red"  ? "var(--danger)"  :
        iconClass === "warn" ? "var(--warning)" : "#555";
    document.getElementById('result-sub').innerText    = sub;

    const icon = document.getElementById('result-icon');
    icon.className = 'result-icon';
    void icon.offsetWidth;
    icon.className = `result-icon ${iconClass}`;

    showOnly('result-box');
    setMsg("", "");
}

// ── Countdown ─────────────────────────────────────────────────────────────────
function iniciarCuentaAtras() {
    document.getElementById('header').innerText = "ACCESO CONCEDIDO";
    setMsg("PORTÓN ABIERTO", "success");
    showOnly('countdown-box');

    const cd       = document.getElementById('seconds');
    const cdInline = document.getElementById('seconds-inline');
    let seconds    = 50;
    cd.innerText = cdInline.innerText = seconds;

    countdownTimer = setInterval(() => {
        seconds--;
        cd.innerText = cdInline.innerText = seconds;

        if (seconds <= 0) {
            clearInterval(countdownTimer);
            countdownTimer = null;
            // Animación de cierre antes de recargar
            animarCierre(() => returnToNumpad());
        }
    }, 1000);
}

// ── Volver al numpad ───────────────────────────────────────────────────────────
function returnToNumpad() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (gateInterval)   { clearInterval(gateInterval);   gateInterval = null; }

    document.getElementById('explosion').classList.remove('boom-active');
    document.getElementById('gate-left').style.transform  = 'translateX(0%)';
    document.getElementById('gate-right').style.transform = 'translateX(0%)';
    document.getElementById('door-percent').innerText = "0%";
    document.getElementById('gate-wrapper').classList.remove('closing');

    currentPin = "";
    document.getElementById('header').innerText = "BIENVENIDO";
    resetProcessing();
    showOnly('pin-interface');
    updateDisplay();
    resetMsg();
}

function resetProcessing() {
    isProcessing = false;
    document.getElementById('btn-send').disabled = false;
}

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initGPS);
