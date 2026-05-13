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

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_FOLDER = 'uploads_zips';
const GAMES_FOLDER = 'public/games';

if (!fs.existsSync(UPLOADS_FOLDER)) fs.mkdirSync(UPLOADS_FOLDER);
if (!fs.existsSync(GAMES_FOLDER)) fs.mkdirSync(GAMES_FOLDER, { recursive: true });

const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_FOLDER),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: diskStorage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

function findIndexHtml(dirPath) {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
        if (file.toLowerCase() === 'index.html') {
            return dirPath;
        }
        const filePath = path.join(dirPath, file);
        if (fs.statSync(filePath).isDirectory()) {
            const result = findIndexHtml(filePath);
            if (result) return result;
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

// Smart Middleware to Cache Games from Firebase
app.use('/games/:gameId', async (req, res, next) => {
    const gameId = req.params.gameId;
    const localGamePath = path.join(GAMES_FOLDER, gameId);
    
    // If the game is already extracted locally, just serve it
    if (fs.existsSync(localGamePath)) {
        return next();
    }
    
    console.log(`[Cache Miss] Game ${gameId} not found locally. Fetching from Firebase...`);
    try {
        // Try to fetch the zip from Firebase Storage using getDownloadURL to avoid 10MB getBytes limit
        const storageRef = ref(storage, `games/${gameId}.zip`);
        const url = await getDownloadURL(storageRef);
        
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
        
        const arrayBuffer = await response.arrayBuffer();
        
        // Save the downloaded zip locally
        const zipPath = path.join(UPLOADS_FOLDER, `${gameId}.zip`);
        fs.writeFileSync(zipPath, Buffer.from(arrayBuffer));
        
        // Extract it
        fs.mkdirSync(localGamePath, { recursive: true });
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(localGamePath, true);
        
        let indexHtmlPath = findIndexHtml(localGamePath);
        if (indexHtmlPath) {
            reorganizeGameFiles(localGamePath, indexHtmlPath);
        }
        
        console.log(`[Cache Hit] Game ${gameId} extracted successfully.`);
        next();
    } catch (error) {
        console.error(`[Error] Failed to fetch/extract game ${gameId}:`, error);
        
        // Fallback for old games that might still be pointing to an external URL
        try {
            const q = query(collection(db, "games"), where("id", "==", gameId));
            const snapshot = await getDocs(q);
            let fallbackUrl = null;
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                if (data.url && data.url.startsWith('http')) {
                    fallbackUrl = data.url;
                }
            });
            
            if (fallbackUrl) {
                console.log(`[Fallback] Redirecting old game ${gameId} to ${fallbackUrl}`);
                return res.redirect(fallbackUrl);
            }
        } catch (fallbackErr) {
            console.error("Fallback error:", fallbackErr);
        }

        res.status(404).send('Jogo não encontrado ou erro ao baixar do servidor remoto.');
    }
});

// Serve the games statically after middleware
app.use('/games', express.static(GAMES_FOLDER));

app.post('/upload', upload.single('gameFile'), async (req, res) => {
    try {
        const { gameTitle, authorName, gameCategory, city, school, studentClass } = req.body;
        const file = req.file;

        if (!file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

        const gameId = Date.now().toString();
        const localGamePath = path.join(GAMES_FOLDER, gameId);
        fs.mkdirSync(localGamePath);

        let indexHtmlPath = null;
        let storageFileRef = ref(storage, `games/${gameId}.zip`);

        if (file.originalname.toLowerCase().endsWith('.zip')) {
            const zip = new AdmZip(file.path);
            zip.extractAllTo(localGamePath, true);
            indexHtmlPath = findIndexHtml(localGamePath);
            
            // Upload the original zip to Firebase Storage
            const fileBuffer = fs.readFileSync(file.path);
            await uploadBytes(storageFileRef, fileBuffer, { contentType: 'application/zip' });
            
        } else if (file.originalname.toLowerCase().endsWith('.html')) {
            fs.copyFileSync(file.path, path.join(localGamePath, 'index.html'));
            indexHtmlPath = localGamePath;
            
            // If it's a single HTML file, zip it first so we store everything uniformly as .zip
            const zipOut = new AdmZip();
            zipOut.addLocalFile(file.path);
            const outBuffer = zipOut.toBuffer();
            await uploadBytes(storageFileRef, outBuffer, { contentType: 'application/zip' });
        } else {
            fs.rmSync(localGamePath, { recursive: true, force: true });
            fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'Envie um arquivo .zip ou .html' });
        }

        fs.unlinkSync(file.path);

        if (!indexHtmlPath || !fs.existsSync(path.join(indexHtmlPath, 'index.html'))) {
            fs.rmSync(localGamePath, { recursive: true, force: true });
            return res.status(400).json({ error: 'Arquivo index.html não encontrado' });
        }

        reorganizeGameFiles(localGamePath, indexHtmlPath);

        const gameUrl = `/games/${gameId}/index.html`;
        
        // Save metadata to Firestore
        const newGame = {
            id: gameId,
            title: gameTitle,
            author: authorName,
            category: gameCategory,
            city: city || null,
            school: school || null,
            studentClass: studentClass || null,
            url: gameUrl,
            timestamp: Date.now()
        };
        
        await addDoc(collection(db, "games"), newGame);

        res.status(200).json({ message: 'Jogo enviado com sucesso!', game: newGame });
    } catch (error) {
        console.error('Erro no upload:', error);
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
        res.json(games);
    } catch (error) {
        console.error('Erro ao listar:', error);
        // Fallback to empty array to not crash the frontend
        res.json([]);
    }
});

app.delete('/api/games/:gameId', async (req, res) => {
    try {
        const gameId = req.params.gameId;
        
        // Find document in Firestore
        const q = query(collection(db, "games"));
        const snapshot = await getDocs(q);
        let targetDocId = null;
        
        snapshot.forEach((docSnap) => {
            if (docSnap.data().id === gameId) {
                targetDocId = docSnap.id;
            }
        });
        
        if (!targetDocId) {
            return res.status(404).json({ error: 'Jogo não encontrado' });
        }
        
        // Delete from Firestore
        await deleteDoc(doc(db, "games", targetDocId));
        
        // Delete from Storage
        try {
            const storageRef = ref(storage, `games/${gameId}.zip`);
            await deleteObject(storageRef);
        } catch (e) {
            console.error('File missing in storage, skipping deletion', e);
        }

        // Delete Local Cache
        const localGamePath = path.join(GAMES_FOLDER, gameId);
        if (fs.existsSync(localGamePath)) {
            fs.rmSync(localGamePath, { recursive: true, force: true });
        }

        res.status(200).json({ message: 'Jogo deletado com sucesso!' });
    } catch (error) {
        console.error('Erro ao deletar:', error);
        res.status(500).json({ error: 'Erro ao deletar o jogo: ' + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});