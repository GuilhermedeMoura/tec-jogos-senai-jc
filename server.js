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

if (!fs.existsSync(UPLOADS_FOLDER)) fs.mkdirSync(UPLOADS_FOLDER);
if (!fs.existsSync(GAMES_FOLDER)) fs.mkdirSync(GAMES_FOLDER, { recursive: true });

const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'coverImage') return cb(null, COVERS_FOLDER);
        cb(null, UPLOADS_FOLDER);
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: diskStorage });

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

app.post('/upload', upload.fields([{ name: 'gameFile', maxCount: 1 }, { name: 'coverImage', maxCount: 1 }]), async (req, res) => {
    try {
        const { gameTitle, authorName, gameCategory, city, school, studentClass } = req.body;
        const file = req.files && req.files['gameFile'] ? req.files['gameFile'][0] : null;
        const coverFile = req.files && req.files['coverImage'] ? req.files['coverImage'][0] : null;

        if (!file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

        const gameId = Date.now().toString();
        const localGamePath = path.join(GAMES_FOLDER, gameId);
        
        try {
            fs.mkdirSync(localGamePath, { recursive: true });
        } catch (err) {
            console.warn('[Warning] Could not create local game folder (non-critical):', err.message);
        }

        let indexHtmlPath = null;
        let indexInfo = null;
        let storageFileRef = ref(storage, `games/${gameId}.zip`);
        let uploadedToStorage = false;

        try {
            if (file.originalname.toLowerCase().endsWith('.zip')) {
                const zip = new AdmZip(file.path);
                zip.extractAllTo(localGamePath, true);
                indexInfo = findIndexHtml(localGamePath);
                if (indexInfo) {
                    indexHtmlPath = indexInfo.dirPath;
                }
                
                // Upload the original zip to Firebase Storage
                const fileBuffer = fs.readFileSync(file.path);
                await uploadBytes(storageFileRef, fileBuffer, { contentType: 'application/zip' });
                uploadedToStorage = true;
                console.log(`[Storage] Uploaded ZIP for game ${gameId}`);
                
            } else if (file.originalname.toLowerCase().endsWith('.html')) {
                fs.copyFileSync(file.path, path.join(localGamePath, 'index.html'));
                indexHtmlPath = localGamePath;
                
                // If it's a single HTML file, zip it so we store everything uniformly
                const zipOut = new AdmZip();
                zipOut.addLocalFile(file.path);
                const outBuffer = zipOut.toBuffer();
                await uploadBytes(storageFileRef, outBuffer, { contentType: 'application/zip' });
                uploadedToStorage = true;
                console.log(`[Storage] Uploaded HTML as ZIP for game ${gameId}`);
            } else {
                fs.rmSync(localGamePath, { recursive: true, force: true });
                fs.unlinkSync(file.path);
                return res.status(400).json({ error: 'Envie um arquivo .zip ou .html' });
            }
        } catch (uploadErr) {
            console.error('[Error] Failed to upload to Firebase Storage:', uploadErr.message);
            // Continue anyway - Firestore will have the metadata
        }

        fs.unlinkSync(file.path);

        if (!indexHtmlPath || !fs.existsSync(path.join(indexHtmlPath, indexInfo ? indexInfo.fileName : 'index.html'))) {
            fs.rmSync(localGamePath, { recursive: true, force: true });
            return res.status(400).json({ error: 'Arquivo index.html não encontrado no ZIP.' });
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
        const games = [];
        
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            games.push({
                docId: docSnap.id,
                ...data
            });
        });
        
        console.log(`[API] Loaded ${games.length} games from Firestore`);
        res.json(games);
    } catch (error) {
        console.error('[Error] Failed to load games from Firestore:', error.message);
        // Fallback to empty array to not crash the frontend
        res.status(200).json([]);
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