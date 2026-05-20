const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

// Firebase Initialization
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, deleteDoc, doc, getDocs, query, orderBy, where } = require('firebase/firestore');
const { getStorage, ref, uploadBytes, getBytes, deleteObject, getDownloadURL } = require('firebase/storage');

const firebaseConfig = {
  apiKey: "AIzaSyD0J8UyDyOxhhpj9pvNj-eUuSRiWJ8Qjv8",
  authDomain: "tec-jogos-senai-jc.firebaseapp.com",
  projectId: "tec-jogos-senai-jc",
  storageBucket: "tec-jogos-senai-jc.firebasestorage.app",
  messagingSenderId: "952832354030",
  appId: "1:952832354030:web:93698003ddef974521f5ff"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const storage = getStorage(firebaseApp, 'gs://tec-jogos-senai-jc.firebasestorage.app');

// Test Firebase Connection on startup
console.log('[Init] Testing Firebase Firestore connection...');
getDocs(collection(db, "games")).then(() => {
    console.log('[Init] ✓ Firebase Firestore connected successfully');
}).catch(err => {
    console.error('[Init] ✗ Firebase Firestore connection failed:', err.message);
});

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_FOLDER = 'uploads_zips';
const GAMES_FOLDER = 'public/games';
const SITES_FOLDER = 'public/sites';

if (!fs.existsSync(UPLOADS_FOLDER)) fs.mkdirSync(UPLOADS_FOLDER);
if (!fs.existsSync(GAMES_FOLDER)) fs.mkdirSync(GAMES_FOLDER, { recursive: true });
if (!fs.existsSync(SITES_FOLDER)) fs.mkdirSync(SITES_FOLDER, { recursive: true });

const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'coverImage') return cb(null, UPLOADS_FOLDER);
        cb(null, UPLOADS_FOLDER);
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({
    storage: diskStorage,
    limits: { fileSize: 200 * 1024 * 1024 } // 200 MB
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Headers necessários para jogos Unity WebGL e Godot (SharedArrayBuffer)
app.use('/games', (req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    next();
});

app.use(express.static('public'));

// Health Check Endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

// Firebase Status Endpoint
app.get('/api/status', async (req, res) => {
    try {
        const q = query(collection(db, "games"));
        const snapshot = await getDocs(q);
        res.json({ 
            status: 'ok', 
            firebase: 'connected',
            gamesCount: snapshot.size,
            timestamp: Date.now()
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            firebase: 'disconnected',
            error: error.message 
        });
    }
});

function findIndexHtml(dirPath) {
    const files = fs.readdirSync(dirPath);
    
    // Filtra pastas indesejadas como __MACOSX e arquivos ocultos do Mac
    const validFiles = files.filter(f => !f.includes('__MACOSX') && f !== 'node_modules' && !f.startsWith('._'));
    
    // First pass: Look for index.html exactly
    for (const file of validFiles) {
        if (file.toLowerCase() === 'index.html') {
            return { dirPath, fileName: file };
        }
    }
    
    // Second pass: Recursive search in subdirectories
    for (const file of validFiles) {
        const filePath = path.join(dirPath, file);
        try {
            if (fs.statSync(filePath).isDirectory()) {
                const result = findIndexHtml(filePath);
                if (result) return result;
            }
        } catch (err) {
            console.warn(`[Warning] Could not stat file ${filePath}:`, err.message);
        }
    }
    
    // Fallback: Accept any .html file if no index.html found
    for (const file of validFiles) {
        if (file.toLowerCase().endsWith('.html')) {
            console.warn(`[Warning] No index.html found, using ${file} as entry point`);
            return { dirPath, fileName: file };
        }
    }
    
    return null;
}

function reorganizeGameFiles(gamePath, indexHtmlPath) {
    if (indexHtmlPath === gamePath) return;

    function moveContents(sourceDir, targetDir) {
        const items = fs.readdirSync(sourceDir);
        items.forEach(item => {
            const sourcePath = path.join(sourceDir, item);
            const targetPath = path.join(targetDir, item);

            if (fs.statSync(sourcePath).isDirectory()) {
                if (!fs.existsSync(targetPath)) {
                    fs.mkdirSync(targetPath, { recursive: true });
                }
                moveContents(sourcePath, targetPath);
            } else {
                fs.copyFileSync(sourcePath, targetPath);
            }
        });
    }

    moveContents(indexHtmlPath, gamePath);
}

// Converte um título em slug seguro para uso em IDs/caminhos de arquivo
function slugify(text) {
    return (text || 'jogo')
        .toString()
        .normalize('NFD')                   // decompõe acentos (é → e + ́)
        .replace(/[\u0300-\u036f]/g, '')    // remove marcas de acento
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')       // remove caracteres especiais
        .replace(/[\s_]+/g, '-')            // espaços/underscores → hífen
        .replace(/-+/g, '-')                // colapsa hífens duplos
        .replace(/^-+|-+$/g, '')            // remove hífens das bordas
        .substring(0, 40)                   // limita o tamanho
        || 'jogo';                          // fallback se ficar vazio
}

// Encontra o arquivo Python principal dentro de um diretório
function findMainPython(dirPath) {
    const files = fs.readdirSync(dirPath).filter(f =>
        !f.includes('__MACOSX') && !f.startsWith('._') && f !== 'node_modules'
    );

    // Prioridade 1: main.py
    for (const file of files) {
        if (file.toLowerCase() === 'main.py') return { dirPath, fileName: file };
    }

    // Prioridade 2: subdiretórios
    for (const file of files) {
        const filePath = path.join(dirPath, file);
        try {
            if (fs.statSync(filePath).isDirectory()) {
                const result = findMainPython(filePath);
                if (result) return result;
            }
        } catch (e) {}
    }

    // Prioridade 3: qualquer .py
    for (const file of files) {
        if (file.toLowerCase().endsWith('.py')) return { dirPath, fileName: file };
    }

    return null;
}

// Gera um index.html que usa Pygbag (Pygame → WebAssembly) para rodar o jogo no browser
// Escaneia todos os arquivos da pasta do jogo (exceto index.html)
function scanGameFiles(gameFolder) {
    const files = [];
    function walk(dir, relBase) {
        try {
            const items = fs.readdirSync(dir).filter(f =>
                !f.startsWith('.') && !f.includes('__MACOSX') && f !== 'index.html'
            );
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const relPath  = relBase ? `${relBase}/${item}` : item;
                try {
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        walk(fullPath, relPath);
                    } else if (stat.size <= 30 * 1024 * 1024) { // ignora arquivos > 30 MB
                        files.push(relPath);
                    }
                } catch (_) {}
            }
        } catch (_) {}
    }
    walk(gameFolder, '');
    return files;
}

function generatePygbagRunner(mainPyName, gameFolder) {
    // Lista de todos os assets que o runner vai carregar no FS virtual
    const gameFiles = gameFolder ? scanGameFiles(gameFolder) : [mainPyName];
    const filesJson = JSON.stringify(gameFiles);

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🐍 Python / Pygame</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: #0d0d1a;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            font-family: 'Courier New', monospace;
            color: #e0e0e0;
        }
        #status-box {
            text-align: center;
            padding: 2rem;
            max-width: 520px;
            width: 90%;
        }
        #status-box h2 { font-size: 1.5rem; color: #f8c037; margin-bottom: .5rem; }
        #step  { font-size: .9rem; opacity: .8; margin: .75rem 0; min-height: 1.2em; }
        #track { background: #1e1e2e; border-radius: 6px; overflow: hidden; margin: .75rem 0; }
        #bar   { height: 6px; background: linear-gradient(90deg,#f8c037,#ff6b35); width: 0%; transition: width .4s ease; }
        #error-box {
            display: none;
            background: #2a0a0a;
            border: 1px solid #c0392b;
            border-radius: 8px;
            padding: 1rem 1.5rem;
            margin-top: 1rem;
            text-align: left;
            font-size: .8rem;
            color: #e74c3c;
            white-space: pre-wrap;
            max-height: 200px;
            overflow-y: auto;
        }
        #tip {
            margin-top: 1.25rem;
            font-size: .72rem;
            opacity: .4;
            line-height: 1.7;
        }
        #tip code { color: #f8c037; }
        canvas { display: block; max-width: 100vw; max-height: 100vh; }
    </style>
</head>
<body>
    <div id="status-box">
        <h2>🐍 Carregando Python + Pygame</h2>
        <div id="step">Iniciando runtime WebAssembly...</div>
        <div id="track"><div id="bar"></div></div>
        <div id="error-box"></div>
        <div id="tip">
            O runtime pode levar <strong>30–60 s</strong> na 1ª vez.<br>
            O loop principal deve usar <code>await asyncio.sleep(0)</code>.<br>
            Imagens e sons são carregados automaticamente do ZIP.
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/pyodide/v0.27.4/full/pyodide.js"></script>
    <script>
    const GAME_FILES = ${filesJson};
    const MAIN_PY   = '${mainPyName}';

    const bar    = document.getElementById('bar');
    const step   = document.getElementById('step');
    const errBox = document.getElementById('error-box');

    function setProgress(pct, msg) {
        bar.style.width = pct + '%';
        step.textContent = msg;
    }
    function showError(msg) {
        errBox.style.display = 'block';
        errBox.textContent   = msg;
        step.textContent     = '❌ Falha ao carregar o jogo.';
        bar.style.background = '#c0392b';
        bar.style.width      = '100%';
    }

    // Cria diretórios aninhados no FS virtual do Pyodide
    function mkdirp(pyodide, relPath) {
        const parts = relPath.split('/').filter(Boolean);
        let cur = '/game';
        for (const p of parts) {
            cur += '/' + p;
            try { pyodide.FS.mkdir(cur); } catch (_) {}
        }
    }

    async function runGame() {
        try {
            setProgress(8, 'Baixando runtime Pyodide...');
            const pyodide = await loadPyodide();

            setProgress(30, 'Carregando pygame-ce...');
            await pyodide.loadPackage('pygame-ce');

            // Cria o diretório raiz do jogo no FS virtual
            try { pyodide.FS.mkdir('/game'); } catch (_) {}

            // ── Carrega TODOS os arquivos do jogo no FS virtual ──────────────
            const total = GAME_FILES.length;
            setProgress(50, \`Carregando \${total} arquivo(s) do jogo...\`);

            for (let i = 0; i < total; i++) {
                const relPath = GAME_FILES[i];
                try {
                    // Cria subdiretórios se necessário
                    const dir = relPath.includes('/') ? relPath.split('/').slice(0, -1).join('/') : null;
                    if (dir) mkdirp(pyodide, dir);

                    const resp = await fetch(relPath);
                    if (resp.ok) {
                        const buf = await resp.arrayBuffer();
                        pyodide.FS.writeFile('/game/' + relPath, new Uint8Array(buf));
                    }
                } catch (e) {
                    console.warn('[Runner] Não foi possível carregar:', relPath, e.message);
                }
                setProgress(50 + Math.round(((i + 1) / total) * 30),
                    \`Carregando arquivos... (\${i + 1}/\${total})\`);
            }
            // ─────────────────────────────────────────────────────────────────

            setProgress(82, 'Configurando ambiente Python...');
            // Muda o diretório de trabalho para /game — caminhos relativos funcionam
            pyodide.runPython('import os; os.chdir("/game")');

            setProgress(90, 'Executando jogo...');

            // Esconde o painel quando o canvas aparecer
            new MutationObserver((_, obs) => {
                if (document.querySelector('canvas')) {
                    obs.disconnect();
                    bar.style.width = '100%';
                    setTimeout(() => {
                        const box = document.getElementById('status-box');
                        if (box) box.style.display = 'none';
                    }, 300);
                }
            }).observe(document.body, { childList: true, subtree: true });

            // Lê e executa o arquivo Python principal do FS virtual
            const code = pyodide.FS.readFile('/game/' + MAIN_PY, { encoding: 'utf8' });
            await pyodide.runPythonAsync(code);
            setProgress(100, 'Concluído.');

        } catch (err) {
            console.error('[PythonRunner]', err);
            showError(err.message || String(err));
        }
    }

    runGame();
    </script>
</body>
</html>`;

}

// Smart Middleware to Stream Games from Firebase with Local Caching
app.use('/games/:gameId', async (req, res, next) => {
    const gameId = req.params.gameId;
    const localGamePath = path.join(GAMES_FOLDER, gameId);
    
    // If the game is already extracted locally, just serve it normally
    if (fs.existsSync(localGamePath)) {
        console.log(`[Cache Hit] Game ${gameId} served from local cache`);
        return next();
    }
    
    console.log(`[Cache Miss] Game ${gameId} not found locally. Streaming from Firebase...`);
    try {
        // Try to fetch the zip from Firebase Storage
        const storageRef = ref(storage, `games/${gameId}.zip`);
        
        // Get download URL to stream directly
        const downloadUrl = await getDownloadURL(storageRef);
        console.log(`[Firebase] Found game zip at: ${downloadUrl.substring(0, 50)}...`);
        
        // Fetch the file from Firebase
        const response = await fetch(downloadUrl);
        if (!response.ok) {
            throw new Error(`Failed to download from Firebase: ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Try to cache it locally (best effort - ignore if it fails)
        try {
            fs.mkdirSync(localGamePath, { recursive: true });
            const zip = new AdmZip(buffer);
            zip.extractAllTo(localGamePath, true);
            
            let indexInfo = findIndexHtml(localGamePath);
            if (indexInfo) {
                reorganizeGameFiles(localGamePath, indexInfo.dirPath);

                // Garantir que o nome final seja 'index.html' (minúsculo)
                const targetHtml = path.join(localGamePath, 'index.html');
                const originalHtml = path.join(localGamePath, indexInfo.fileName);
                if (indexInfo.fileName !== 'index.html' && fs.existsSync(originalHtml)) {
                    fs.renameSync(originalHtml, targetHtml);
                }
            } else {
                // Sem index.html — pode ser um ZIP de jogo Python
                const pythonInfo = findMainPython(localGamePath);
                if (pythonInfo) {
                    reorganizeGameFiles(localGamePath, pythonInfo.dirPath);
                    const runnerHtml = generatePygbagRunner(pythonInfo.fileName, localGamePath);
                    fs.writeFileSync(path.join(localGamePath, 'index.html'), runnerHtml);
                    console.log(`[Cache] Rebuilt Python runner for game ${gameId}: ${pythonInfo.fileName}`);
                }
            }
            console.log(`[Cache] Game ${gameId} cached locally for future requests`);
        } catch (cacheErr) {
            console.warn(`[Cache] Failed to cache game ${gameId} locally (non-critical):`, cacheErr.message);
            // Continue anyway - we'll serve from memory
        }
        
        // Proceed to serve the game
        next();
    } catch (error) {
        console.error(`[Error] Failed to fetch game ${gameId} from Firebase:`, error.message);
        
        res.status(404).json({ 
            error: 'Jogo não encontrado',
            details: error.message 
        });
    }
});

// Serve the games statically after middleware with proper headers for Game Engines (Unity/Godot)
app.use('/games', express.static(GAMES_FOLDER, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.br')) {
            res.setHeader('Content-Encoding', 'br');
            if (filePath.includes('.wasm')) res.setHeader('Content-Type', 'application/wasm');
            if (filePath.includes('.js')) res.setHeader('Content-Type', 'application/javascript');
            if (filePath.includes('.data')) res.setHeader('Content-Type', 'application/octet-stream');
        } else if (filePath.endsWith('.gz')) {
            res.setHeader('Content-Encoding', 'gzip');
            if (filePath.includes('.wasm')) res.setHeader('Content-Type', 'application/wasm');
            if (filePath.includes('.js')) res.setHeader('Content-Type', 'application/javascript');
            if (filePath.includes('.data')) res.setHeader('Content-Type', 'application/octet-stream');
        } else if (filePath.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
        }
    }
}));

// Smart Middleware to Stream Sites from Firebase with Local Caching
app.use('/sites/:siteId', async (req, res, next) => {
    const siteId = req.params.siteId;
    const localSitePath = path.join(SITES_FOLDER, siteId);

    if (fs.existsSync(localSitePath)) {
        console.log(`[Cache Hit] Site ${siteId} served from local cache`);
        return next();
    }

    console.log(`[Cache Miss] Site ${siteId} not found locally. Streaming from Firebase...`);
    try {
        const storageRef = ref(storage, `sites/${siteId}.zip`);
        const downloadUrl = await getDownloadURL(storageRef);

        const response = await fetch(downloadUrl);
        if (!response.ok) throw new Error(`Failed to download from Firebase: ${response.statusText}`);

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        try {
            fs.mkdirSync(localSitePath, { recursive: true });
            const zip = new AdmZip(buffer);
            zip.extractAllTo(localSitePath, true);

            let indexInfo = findIndexHtml(localSitePath);
            if (indexInfo) {
                reorganizeGameFiles(localSitePath, indexInfo.dirPath);
                const targetHtml = path.join(localSitePath, 'index.html');
                const originalHtml = path.join(localSitePath, indexInfo.fileName);
                if (indexInfo.fileName !== 'index.html' && fs.existsSync(originalHtml)) {
                    fs.renameSync(originalHtml, targetHtml);
                }
            }
            console.log(`[Cache] Site ${siteId} cached locally`);
        } catch (cacheErr) {
            console.warn(`[Cache] Failed to cache site ${siteId} (non-critical):`, cacheErr.message);
        }

        next();
    } catch (error) {
        console.error(`[Error] Failed to fetch site ${siteId} from Firebase:`, error.message);
        res.status(404).json({ error: 'Site não encontrado', details: error.message });
    }
});

// Serve sites statically
app.use('/sites', express.static(SITES_FOLDER));

app.post('/upload', upload.fields([{ name: 'gameFile', maxCount: 1 }, { name: 'coverImage', maxCount: 1 }]), async (req, res) => {
    try {
        const { gameTitle, authorName, gameCategory, city, school, studentClass, teacher } = req.body;
        const file = req.files && req.files['gameFile'] ? req.files['gameFile'][0] : null;
        const coverFile = req.files && req.files['coverImage'] ? req.files['coverImage'][0] : null;

        if (!file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

        const gameId = slugify(gameTitle) + '-' + Date.now().toString();
        const localGamePath = path.join(GAMES_FOLDER, gameId);
        
        try {
            fs.mkdirSync(localGamePath, { recursive: true });
        } catch (err) {
            console.warn('[Warning] Could not create local game folder (non-critical):', err.message);
        }

        let indexHtmlPath = null;
        let indexInfo = null;
        let gameType = 'html'; // 'html' | 'python'
        let storageFileRef = ref(storage, `games/${gameId}.zip`);
        let uploadedToStorage = false;

        try {
            if (file.originalname.toLowerCase().endsWith('.zip')) {
                const zip = new AdmZip(file.path);
                zip.extractAllTo(localGamePath, true);
                indexInfo = findIndexHtml(localGamePath);
                if (indexInfo) {
                    // ZIP com HTML normal (Unity, Godot, web game)
                    indexHtmlPath = indexInfo.dirPath;
                } else {
                    // Sem HTML — verifica se é um jogo Python/Pygame
                    const pythonInfo = findMainPython(localGamePath);
                    if (pythonInfo) {
                        reorganizeGameFiles(localGamePath, pythonInfo.dirPath);
                        const runnerHtml = generatePygbagRunner(pythonInfo.fileName, localGamePath);
                        fs.writeFileSync(path.join(localGamePath, 'index.html'), runnerHtml);
                        indexHtmlPath = localGamePath;
                        indexInfo = { dirPath: localGamePath, fileName: 'index.html' };
                        gameType = 'python';
                        console.log(`[Python] Detected Python/Pygame game, main: ${pythonInfo.fileName}`);
                    }
                }

                // ZIP Python: re-empacota a pasta local (que já tem index.html gerado)
                const repackZip = new AdmZip();
                repackZip.addLocalFolder(localGamePath);
                const repackBuffer = repackZip.toBuffer();
                await uploadBytes(storageFileRef, repackBuffer, { contentType: 'application/zip' });
                uploadedToStorage = true;
                console.log(`[Storage] Uploaded repackaged ZIP (with runner) for game ${gameId}`);

            } else if (file.originalname.toLowerCase().endsWith('.html')) {
                fs.copyFileSync(file.path, path.join(localGamePath, 'index.html'));
                indexHtmlPath = localGamePath;

                const zipOut = new AdmZip();
                zipOut.addLocalFile(file.path);
                const outBuffer = zipOut.toBuffer();
                await uploadBytes(storageFileRef, outBuffer, { contentType: 'application/zip' });
                uploadedToStorage = true;
                console.log(`[Storage] Uploaded HTML as ZIP for game ${gameId}`);

            } else if (file.originalname.toLowerCase().endsWith('.py')) {
                // Arquivo Python único (.py)
                fs.copyFileSync(file.path, path.join(localGamePath, file.originalname));
                const runnerHtml = generatePygbagRunner(file.originalname, localGamePath);
                fs.writeFileSync(path.join(localGamePath, 'index.html'), runnerHtml);
                indexHtmlPath = localGamePath;
                indexInfo = { dirPath: localGamePath, fileName: 'index.html' };
                gameType = 'python';

                // Empacota a pasta local inteira (inclui .py + index.html gerado)
                const zipOut = new AdmZip();
                zipOut.addLocalFolder(localGamePath);
                const outBuffer = zipOut.toBuffer();
                await uploadBytes(storageFileRef, outBuffer, { contentType: 'application/zip' });
                uploadedToStorage = true;
                console.log(`[Storage] Uploaded .py + runner as ZIP for game ${gameId}`);

            } else {
                fs.rmSync(localGamePath, { recursive: true, force: true });
                fs.unlinkSync(file.path);
                return res.status(400).json({ error: 'Envie um arquivo .zip, .html ou .py' });
            }
        } catch (uploadErr) {
            console.error('[Error] Failed to upload to Firebase Storage:', uploadErr.message);
            // Continue anyway - Firestore will have the metadata
        }

        fs.unlinkSync(file.path);

        if (!indexHtmlPath || !fs.existsSync(path.join(localGamePath, 'index.html'))) {
            fs.rmSync(localGamePath, { recursive: true, force: true });
            return res.status(400).json({ error: 'Nenhum ponto de entrada encontrado. ZIP deve conter index.html (HTML/Unity/Godot) ou main.py (Python/Pygame).' });
        }

        reorganizeGameFiles(localGamePath, indexHtmlPath);
        
        // Garantir lowercase
        if (indexInfo && indexInfo.fileName !== 'index.html') {
            const originalHtml = path.join(localGamePath, indexInfo.fileName);
            const targetHtml = path.join(localGamePath, 'index.html');
            if (fs.existsSync(originalHtml)) {
                fs.renameSync(originalHtml, targetHtml);
            }
        }

        // Para ZIPs HTML com subpastas (ex: Unity/Godot), re-empacota após reorganizar
        // para que o Firebase Storage tenha sempre index.html na raiz
        if (gameType === 'html' && file.originalname.toLowerCase().endsWith('.zip') && indexInfo && indexInfo.dirPath !== localGamePath) {
            try {
                const repackZip = new AdmZip();
                repackZip.addLocalFolder(localGamePath);
                const repackBuffer = repackZip.toBuffer();
                await uploadBytes(storageFileRef, repackBuffer, { contentType: 'application/zip' });
                console.log(`[Storage] Re-uploaded reorganized HTML ZIP for game ${gameId}`);
            } catch (repackErr) {
                console.warn(`[Storage] Failed to re-upload reorganized ZIP (non-critical):`, repackErr.message);
            }
        }

        // Faz upload da imagem de capa para o Firebase Storage e obtém URL permanente
        let coverUrl = null;
        if (coverFile) {
            try {
                const coverExt = path.extname(coverFile.originalname) || '.jpg';
                const coverStorageRef = ref(storage, `covers/${gameId}${coverExt}`);
                const coverBuffer = fs.readFileSync(coverFile.path);
                const coverMime = coverFile.mimetype || 'image/jpeg';
                await uploadBytes(coverStorageRef, coverBuffer, { contentType: coverMime });
                coverUrl = await getDownloadURL(coverStorageRef);
                fs.unlinkSync(coverFile.path);
                console.log(`[Storage] Cover image uploaded for game ${gameId}: ${coverUrl.substring(0, 60)}...`);
            } catch (coverErr) {
                console.error('[Error] Failed to upload cover image to Firebase Storage:', coverErr.message);
                // coverUrl permanece null — sem capa é aceitável
                try { fs.unlinkSync(coverFile.path); } catch (_) {}
            }
        }

        const gameUrl = `/games/${gameId}/index.html`;
        
        // Save metadata to Firestore with comprehensive info
        const newGame = {
            docId: gameId,
            id: gameId,
            title: gameTitle,
            author: authorName,
            category: gameCategory,
            city: city || null,
            school: school || null,
            studentClass: studentClass || null,
            teacher: teacher || null,
            gameType: gameType,
            url: gameUrl,
            coverUrl: coverUrl,
            storageUrl: `gs://tec-jogos-senai-jc.firebasestorage.app/games/${gameId}.zip`,
            uploadedToStorage: uploadedToStorage,
            timestamp: Date.now(),
            createdAt: new Date().toISOString()
        };
        
        // Save with explicit document ID for consistency
        const docRef = await addDoc(collection(db, "games"), newGame);
        console.log(`[Firestore] Game saved with docId: ${docRef.id}, gameId: ${gameId}`);

        res.status(200).json({ message: 'Jogo enviado com sucesso!', game: { ...newGame, docId: docRef.id } });
    } catch (error) {
        console.error('[Error] Upload failed:', error);
        res.status(500).json({ error: 'Erro ao processar o jogo: ' + error.message });
    }
});

app.get('/api/games', async (req, res) => {
    try {
        const q = query(collection(db, "games"), orderBy("timestamp", "desc"));
        const snapshot = await getDocs(q);

        const rawGames = [];
        snapshot.forEach((docSnap) => {
            rawGames.push({ _firestoreDocId: docSnap.id, ...docSnap.data() });
        });

        // Verifica em paralelo quais jogos ainda existem no Firebase Storage
        const results = await Promise.allSettled(
            rawGames.map(async (game) => {
                const gameId = game.id || game.docId;
                try {
                    const storageRef = ref(storage, `games/${gameId}.zip`);
                    await getDownloadURL(storageRef); // lança erro se não existir
                    return game; // arquivo existe → jogo válido
                } catch (err) {
                    // Arquivo não existe no Storage → remove do Firestore automaticamente
                    console.warn(`[Cleanup] Game ${gameId} not found in Storage. Removing from Firestore...`);
                    try {
                        await deleteDoc(doc(db, "games", game._firestoreDocId));
                        console.log(`[Cleanup] Deleted orphaned Firestore doc: ${game._firestoreDocId}`);
                    } catch (deleteErr) {
                        console.error(`[Cleanup] Failed to delete Firestore doc ${game._firestoreDocId}:`, deleteErr.message);
                    }
                    return null; // sinaliza que deve ser filtrado
                }
            })
        );

        const validGames = results
            .filter(r => r.status === 'fulfilled' && r.value !== null)
            .map(r => {
                const { _firestoreDocId, ...game } = r.value;
                return game;
            });

        console.log(`[API] ${validGames.length}/${rawGames.length} games are valid (${rawGames.length - validGames.length} orphans removed)`);
        res.json(validGames);
    } catch (error) {
        console.error('[Error] Failed to load games from Firestore:', error.message);
        res.status(200).json([]);
    }
});

// ============================================================
// SITES ROUTES
// ============================================================

app.post('/upload-site', upload.fields([{ name: 'gameFile', maxCount: 1 }, { name: 'coverImage', maxCount: 1 }]), async (req, res) => {
    try {
        const { gameTitle, authorName, gameCategory, city, school, studentClass, teacher } = req.body;
        const file = req.files && req.files['gameFile'] ? req.files['gameFile'][0] : null;
        const coverFile = req.files && req.files['coverImage'] ? req.files['coverImage'][0] : null;

        if (!file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

        const siteId = slugify(gameTitle) + '-' + Date.now().toString();
        const localSitePath = path.join(SITES_FOLDER, siteId);

        try {
            fs.mkdirSync(localSitePath, { recursive: true });
        } catch (err) {
            console.warn('[Warning] Could not create local site folder (non-critical):', err.message);
        }

        let indexHtmlPath = null;
        let indexInfo = null;
        let storageFileRef = ref(storage, `sites/${siteId}.zip`);
        let uploadedToStorage = false;

        try {
            if (file.originalname.toLowerCase().endsWith('.zip')) {
                const zip = new AdmZip(file.path);
                zip.extractAllTo(localSitePath, true);
                indexInfo = findIndexHtml(localSitePath);
                if (indexInfo) indexHtmlPath = indexInfo.dirPath;

                const fileBuffer = fs.readFileSync(file.path);
                await uploadBytes(storageFileRef, fileBuffer, { contentType: 'application/zip' });
                uploadedToStorage = true;
                console.log(`[Storage] Uploaded site ZIP for site ${siteId}`);

            } else if (file.originalname.toLowerCase().endsWith('.html')) {
                fs.copyFileSync(file.path, path.join(localSitePath, 'index.html'));
                indexHtmlPath = localSitePath;

                const zipOut = new AdmZip();
                zipOut.addLocalFile(file.path);
                const outBuffer = zipOut.toBuffer();
                await uploadBytes(storageFileRef, outBuffer, { contentType: 'application/zip' });
                uploadedToStorage = true;
                console.log(`[Storage] Uploaded site HTML as ZIP for site ${siteId}`);
            } else {
                fs.rmSync(localSitePath, { recursive: true, force: true });
                fs.unlinkSync(file.path);
                return res.status(400).json({ error: 'Envie um arquivo .zip ou .html' });
            }
        } catch (uploadErr) {
            console.error('[Error] Failed to upload site to Firebase Storage:', uploadErr.message);
        }

        fs.unlinkSync(file.path);

        if (!indexHtmlPath || !fs.existsSync(path.join(indexHtmlPath, indexInfo ? indexInfo.fileName : 'index.html'))) {
            fs.rmSync(localSitePath, { recursive: true, force: true });
            return res.status(400).json({ error: 'Arquivo index.html não encontrado no ZIP.' });
        }

        reorganizeGameFiles(localSitePath, indexHtmlPath);

        if (indexInfo && indexInfo.fileName !== 'index.html') {
            const originalHtml = path.join(localSitePath, indexInfo.fileName);
            const targetHtml = path.join(localSitePath, 'index.html');
            if (fs.existsSync(originalHtml)) fs.renameSync(originalHtml, targetHtml);
        }

        let coverUrl = null;
        if (coverFile) {
            try {
                const coverExt = path.extname(coverFile.originalname) || '.jpg';
                const coverStorageRef = ref(storage, `covers/sites/${siteId}${coverExt}`);
                const coverBuffer = fs.readFileSync(coverFile.path);
                const coverMime = coverFile.mimetype || 'image/jpeg';
                await uploadBytes(coverStorageRef, coverBuffer, { contentType: coverMime });
                coverUrl = await getDownloadURL(coverStorageRef);
                fs.unlinkSync(coverFile.path);
                console.log(`[Storage] Cover image uploaded for site ${siteId}`);
            } catch (coverErr) {
                console.error('[Error] Failed to upload site cover:', coverErr.message);
                try { fs.unlinkSync(coverFile.path); } catch (_) {}
            }
        }

        const siteUrl = `/sites/${siteId}/index.html`;

        const newSite = {
            docId: siteId,
            id: siteId,
            title: gameTitle,
            author: authorName,
            category: gameCategory,
            city: city || null,
            school: school || null,
            studentClass: studentClass || null,
            teacher: teacher || null,
            url: siteUrl,
            coverUrl: coverUrl,
            storageUrl: `gs://tec-jogos-senai-jc.firebasestorage.app/sites/${siteId}.zip`,
            uploadedToStorage: uploadedToStorage,
            timestamp: Date.now(),
            createdAt: new Date().toISOString()
        };

        const docRef = await addDoc(collection(db, "sites"), newSite);
        console.log(`[Firestore] Site saved with docId: ${docRef.id}, siteId: ${siteId}`);

        res.status(200).json({ message: 'Site enviado com sucesso!', site: { ...newSite, docId: docRef.id } });
    } catch (error) {
        console.error('[Error] Site upload failed:', error);
        res.status(500).json({ error: 'Erro ao processar o site: ' + error.message });
    }
});

app.get('/api/sites', async (req, res) => {
    try {
        const q = query(collection(db, "sites"), orderBy("timestamp", "desc"));
        const snapshot = await getDocs(q);

        const rawSites = [];
        snapshot.forEach((docSnap) => {
            rawSites.push({ _firestoreDocId: docSnap.id, ...docSnap.data() });
        });

        // Verifica em paralelo quais sites ainda existem no Firebase Storage
        const results = await Promise.allSettled(
            rawSites.map(async (site) => {
                const siteId = site.id || site.docId;
                try {
                    const storageRef = ref(storage, `sites/${siteId}.zip`);
                    await getDownloadURL(storageRef);
                    return site;
                } catch (err) {
                    console.warn(`[Cleanup] Site ${siteId} not found in Storage. Removing from Firestore...`);
                    try {
                        await deleteDoc(doc(db, "sites", site._firestoreDocId));
                        console.log(`[Cleanup] Deleted orphaned site Firestore doc: ${site._firestoreDocId}`);
                    } catch (deleteErr) {
                        console.error(`[Cleanup] Failed to delete site Firestore doc:`, deleteErr.message);
                    }
                    return null;
                }
            })
        );

        const validSites = results
            .filter(r => r.status === 'fulfilled' && r.value !== null)
            .map(r => {
                const { _firestoreDocId, ...site } = r.value;
                return site;
            });

        console.log(`[API] ${validSites.length}/${rawSites.length} sites are valid`);
        res.json(validSites);
    } catch (error) {
        console.error('[Error] Failed to load sites from Firestore:', error.message);
        res.status(200).json([]);
    }
});

app.delete('/api/sites/:siteId', async (req, res) => {
    try {
        const siteId = req.params.siteId;
        console.log(`[Delete] Attempting to delete site: ${siteId}`);

        const q = query(collection(db, "sites"));
        const snapshot = await getDocs(q);
        let targetDocId = null;
        let siteDataId = null;

        snapshot.forEach((docSnap) => {
            if (docSnap.id === siteId || String(docSnap.data().id) === String(siteId)) {
                targetDocId = docSnap.id;
                siteDataId = docSnap.data().id;
            }
        });

        if (!targetDocId) return res.status(404).json({ error: 'Site não encontrado' });

        await deleteDoc(doc(db, "sites", targetDocId));

        try {
            const zipNameId = siteDataId || siteId;
            if (zipNameId && zipNameId !== "undefined") {
                const storageRef = ref(storage, `sites/${zipNameId}.zip`);
                await deleteObject(storageRef);
            }
        } catch (e) {
            console.warn('[Delete] Site file missing in storage (non-critical):', e.message);
        }

        const localCacheId = siteDataId || siteId;
        if (localCacheId && localCacheId !== "undefined") {
            const localSitePath = path.join(SITES_FOLDER, localCacheId);
            if (fs.existsSync(localSitePath)) {
                fs.rmSync(localSitePath, { recursive: true, force: true });
            }
        }

        res.status(200).json({ message: 'Site deletado com sucesso!' });
    } catch (error) {
        console.error('[Error] Failed to delete site:', error.message);
        res.status(500).json({ error: 'Erro ao deletar o site: ' + error.message });
    }
});

app.delete('/api/games/:gameId', async (req, res) => {
    try {
        const gameId = req.params.gameId;
        console.log(`[Delete] Attempting to delete game: ${gameId}`);
        
        // Find document in Firestore
        const q = query(collection(db, "games"));
        const snapshot = await getDocs(q);
        let targetDocId = null;
        let gameDataId = null;
        
        snapshot.forEach((docSnap) => {
            // Verifica pelo docId do Firebase OU pelo id antigo
            if (docSnap.id === gameId || String(docSnap.data().id) === String(gameId)) {
                targetDocId = docSnap.id;
                gameDataId = docSnap.data().id;
                console.log(`[Delete] Found game in Firestore: docId=${targetDocId}, gameId=${gameDataId}`);
            }
        });
        
        if (!targetDocId) {
            console.warn(`[Delete] Game not found: ${gameId}`);
            return res.status(404).json({ error: 'Jogo não encontrado' });
        }
        
        // Delete from Firestore
        await deleteDoc(doc(db, "games", targetDocId));
        console.log(`[Delete] Deleted from Firestore: ${targetDocId}`);
        
        // Delete from Storage
        try {
            const zipNameId = gameDataId || gameId;
            if (zipNameId && zipNameId !== "undefined") {
                const storageRef = ref(storage, `games/${zipNameId}.zip`);
                await deleteObject(storageRef);
                console.log(`[Delete] Deleted from Storage: games/${zipNameId}.zip`);
            }
        } catch (e) {
            console.warn('[Delete] File missing in storage (non-critical):', e.message);
        }

        // Delete Local Cache
        const localCacheId = gameDataId || gameId;
        if (localCacheId && localCacheId !== "undefined") {
            const localGamePath = path.join(GAMES_FOLDER, localCacheId);
            if (fs.existsSync(localGamePath)) {
                fs.rmSync(localGamePath, { recursive: true, force: true });
                console.log(`[Delete] Deleted local cache: ${localGamePath}`);
            }
        }

        res.status(200).json({ message: 'Jogo deletado com sucesso!' });
    } catch (error) {
        console.error('[Error] Failed to delete game:', error.message);
        res.status(500).json({ error: 'Erro ao deletar o jogo: ' + error.message });
    }
});

// Middleware global de erros — garante que qualquer crash retorne JSON (não HTML)
app.use((err, req, res, next) => {
    // Erros do multer (ex: arquivo muito grande)
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Arquivo muito grande. O limite é 200 MB.' });
    }
    if (err.name === 'MulterError') {
        return res.status(400).json({ error: `Erro no upload: ${err.message}` });
    }
    console.error('[Unhandled Error]', err);
    res.status(500).json({ error: err.message || 'Erro interno do servidor' });
});

app.listen(PORT, () => {
    console.log('\n========================================');
    console.log('[Startup] Servidor TecJogos iniciado');
    console.log(`[Startup] Porta: ${PORT}`);
    console.log(`[Startup] Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log(`[Startup] Firebase Project: tec-jogos-senai-jc`);
    console.log(`[Startup] Base Storage: ${GAMES_FOLDER}`);
    console.log('[Startup] URLs:');
    console.log(`  - Aplicação: http://localhost:${PORT}`);
    console.log(`  - Status: http://localhost:${PORT}/health`);
    console.log(`  - API Status: http://localhost:${PORT}/api/status`);
    console.log(`  - Listar Jogos: http://localhost:${PORT}/api/games`);
    console.log('========================================\n');
});