const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_FOLDER = 'uploads_zips';
const GAMES_FOLDER = 'public/games';
const DATA_FILE = 'data.json';

if (!fs.existsSync(UPLOADS_FOLDER)) fs.mkdirSync(UPLOADS_FOLDER);
if (!fs.existsSync(GAMES_FOLDER)) fs.mkdirSync(GAMES_FOLDER, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_FOLDER),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/games', express.static(GAMES_FOLDER));

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

app.post('/upload', upload.single('gameFile'), (req, res) => {
    try {
        const { gameTitle, authorName, gameCategory } = req.body;
        const file = req.file;

        if (!file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

        const gameId = Date.now().toString();
        const gamePath = path.join(GAMES_FOLDER, gameId);
        fs.mkdirSync(gamePath);

        let indexHtmlPath = null;

        if (file.originalname.toLowerCase().endsWith('.zip')) {
            const zip = new AdmZip(file.path);
            zip.extractAllTo(gamePath, true);
            indexHtmlPath = findIndexHtml(gamePath);
        } else if (file.originalname.toLowerCase().endsWith('.html')) {
            fs.copyFileSync(file.path, path.join(gamePath, 'index.html'));
            indexHtmlPath = gamePath;
        } else {
            fs.rmSync(gamePath, { recursive: true, force: true });
            fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'Envie um arquivo .zip ou .html' });
        }

        fs.unlinkSync(file.path);

        if (!indexHtmlPath || !fs.existsSync(path.join(indexHtmlPath, 'index.html'))) {
            fs.rmSync(gamePath, { recursive: true, force: true });
            return res.status(400).json({ error: 'Arquivo index.html não encontrado no ZIP' });
        }

        reorganizeGameFiles(gamePath, indexHtmlPath);

        const gameUrl = `/games/${gameId}/index.html`;
        const games = JSON.parse(fs.readFileSync(DATA_FILE));
        const newGame = {
            id: gameId,
            title: gameTitle,
            author: authorName,
            category: gameCategory,
            url: gameUrl
        };
        games.push(newGame);
        fs.writeFileSync(DATA_FILE, JSON.stringify(games, null, 2));

        res.status(200).json({ message: 'Jogo enviado com sucesso!', game: newGame });
    } catch (error) {
        console.error('Erro no upload:', error);
        res.status(500).json({ error: 'Erro ao processar o jogo: ' + error.message });
    }
});

app.get('/api/games', (req, res) => {
    const games = JSON.parse(fs.readFileSync(DATA_FILE));
    res.json(games);
});

app.delete('/api/games/:gameId', (req, res) => {
    try {
        const gameId = req.params.gameId;
        const games = JSON.parse(fs.readFileSync(DATA_FILE));
        const gameIndex = games.findIndex(g => g.id === gameId);

        if (gameIndex === -1) {
            return res.status(404).json({ error: 'Jogo não encontrado' });
        }

        const game = games[gameIndex];
        const gamePath = path.join(GAMES_FOLDER, gameId);
        if (fs.existsSync(gamePath)) {
            fs.rmSync(gamePath, { recursive: true, force: true });
        }

        games.splice(gameIndex, 1);
        fs.writeFileSync(DATA_FILE, JSON.stringify(games, null, 2));

        res.status(200).json({ message: 'Jogo deletado com sucesso!' });
    } catch (error) {
        console.error('Erro ao deletar:', error);
        res.status(500).json({ error: 'Erro ao deletar o jogo: ' + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});