require('dotenv').config();
const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');


// Firebase Initialization
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, deleteDoc, updateDoc, increment, doc, getDocs, query, orderBy, where } = require('firebase/firestore');
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

// --- SMTP CONFIGURATION FOR EMAIL RECOVERY ---
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true para porta 465, false para 587 ou 25
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// Testar transporter no início
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter.verify((error) => {
        if (error) {
            console.error('[SMTP] ✗ Erro de conexão SMTP:', error.message);
        } else {
            console.log('[SMTP] ✓ Servidor SMTP pronto para enviar e-mails');
        }
    });
} else {
    console.warn('[SMTP] ⚠ SMTP não configurado. Os e-mails de recuperação serão apenas exibidos no console.');
}

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');

// --- IN-MEMORY RATE LIMITER ---
const ipRequests = new Map();
function rateLimiter(maxRequests, windowMs) {
    return (req, res, next) => {
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const now = Date.now();
        
        if (!ipRequests.has(ip)) {
            ipRequests.set(ip, []);
        }
        
        let timestamps = ipRequests.get(ip).filter(t => now - t < windowMs);
        timestamps.push(now);
        ipRequests.set(ip, timestamps);
        
        if (timestamps.length > maxRequests) {
            return res.status(429).json({ 
                error: 'Muitas requisições enviadas. Por favor, tente novamente mais tarde.' 
            });
        }
        
        next();
    };
}

// --- INPUT SANITIZER ---
function sanitizeInput(text, maxLength = 100) {
    if (typeof text !== 'string') return '';
    return text
        .trim()
        .slice(0, maxLength)
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

// --- ZIP ARCHIVE SECURITY VALIDATOR (Zip Bomb, Zip Slip, Malware) ---
function validateZipArchive(filePath, maxUncompressedSize = 100 * 1024 * 1024, maxFilesCount = 1000) {
    try {
        const zip = new AdmZip(filePath);
        const entries = zip.getEntries();
        
        if (entries.length > maxFilesCount) {
            throw new Error(`O arquivo ZIP contém muitos arquivos (${entries.length}). O limite é ${maxFilesCount}.`);
        }
        
        let totalUncompressedSize = 0;
        
        for (const entry of entries) {
            if (entry.isDirectory) continue;
            
            const uncompressedSize = entry.header.size;
            totalUncompressedSize += uncompressedSize;
            
            if (totalUncompressedSize > maxUncompressedSize) {
                throw new Error(`O tamanho total descompactado excede o limite permitido de ${maxUncompressedSize / (1024 * 1024)} MB (possível Zip Bomb).`);
            }
            
            const entryName = entry.entryName;
            
            // Zip Slip / Path Traversal Defense
            if (entryName.includes('..') || entryName.startsWith('/') || entryName.includes('\\..') || entryName.includes('../')) {
                throw new Error(`Arquivo inválido ou tentativa de Path Traversal no ZIP: ${entryName}`);
            }
            
            // Dangerous file extensions block
            const ext = path.extname(entryName).toLowerCase();
            const dangerousExtensions = ['.exe', '.bat', '.cmd', '.sh', '.php', '.asp', '.aspx', '.jsp', '.jar', '.dll', '.lnk', '.vbs', '.scr', '.pif'];
            if (dangerousExtensions.includes(ext)) {
                throw new Error(`O ZIP contém arquivos perigosos não permitidos: ${entryName}`);
            }
        }
        return true;
    } catch (err) {
        throw new Error(err.message || 'Falha ao validar o arquivo ZIP.');
    }
}

const UPLOADS_FOLDER = 'uploads_zips';
const GAMES_FOLDER = 'public/games';
const SITES_FOLDER = 'public/sites';

if (!fs.existsSync(UPLOADS_FOLDER)) fs.mkdirSync(UPLOADS_FOLDER);
if (!fs.existsSync(GAMES_FOLDER)) fs.mkdirSync(GAMES_FOLDER, { recursive: true });
if (!fs.existsSync(SITES_FOLDER)) fs.mkdirSync(SITES_FOLDER, { recursive: true });

const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_FOLDER);
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const uploadGame = multer({
    storage: diskStorage,
    limits: { fileSize: 105 * 1024 * 1024 } // 105 MB
});

const uploadSite = multer({
    storage: diskStorage,
    limits: { fileSize: 55 * 1024 * 1024 } // 55 MB
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- PASSWORD HASHING HELPERS ---
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return { salt, hash };
}

function verifyPassword(password, salt, hash) {
    const checkHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return checkHash === hash;
}

// --- STUDENT AUTHENTICATION SYSTEM ---

// Auth Middleware
async function authenticateUser(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        req.user = null;
        return next();
    }
    
    const token = authHeader.split(' ')[1];
    try {
        const q = query(collection(db, "sessions"), where("token", "==", token));
        const snap = await getDocs(q);
        if (snap.empty) {
            req.user = null;
            return next();
        }
        
        let sessionDoc = null;
        snap.forEach(d => { sessionDoc = { id: d.id, ...d.data() }; });
        
        if (sessionDoc.expiresAt < Date.now()) {
            try { await deleteDoc(doc(db, "sessions", sessionDoc.id)); } catch (_) {}
            req.user = null;
            return next();
        }
        
        req.user = {
            userId: sessionDoc.userId,
            username: sessionDoc.username,
            name: sessionDoc.name
        };
    } catch (err) {
        console.error('[Auth Middleware Error]', err);
        req.user = null;
    }
    next();
}

// Strict Auth Middleware
function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Você precisa estar logado para realizar esta ação.' });
    }
    next();
}

// Registro de Aluno
app.post('/api/auth/register', rateLimiter(10, 60 * 60 * 1000), async (req, res) => {
    try {
        const username = sanitizeInput(req.body.username, 30).toLowerCase();
        const name = sanitizeInput(req.body.name, 50);
        const email = sanitizeInput(req.body.email, 100).toLowerCase();
        const password = req.body.password;
        
        if (!username || !name || !email || !password) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
        }
        
        if (username.length < 3 || password.length < 6) {
            return res.status(400).json({ error: 'Nome de usuário deve ter pelo menos 3 caracteres e a senha pelo menos 6.' });
        }

        // Validar e-mail
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Utilize um e-mail válido.' });
        }

        // Verificar se usuário existe
        const qUser = query(collection(db, "users"), where("username", "==", username));
        const snapUser = await getDocs(qUser);
        if (!snapUser.empty) {
            return res.status(400).json({ error: 'Este nome de usuário já está em uso.' });
        }

        // Verificar se e-mail existe
        const qEmail = query(collection(db, "users"), where("email", "==", email));
        const snapEmail = await getDocs(qEmail);
        if (!snapEmail.empty) {
            return res.status(400).json({ error: 'Este e-mail escolar já está cadastrado.' });
        }
        
        const { salt, hash } = hashPassword(password);
        const newUser = { username, name, email, salt, hash, createdAt: Date.now() };
        const docRef = await addDoc(collection(db, "users"), newUser);
        
        const token = crypto.randomBytes(32).toString('hex');
        const session = {
            token,
            userId: docRef.id,
            username,
            name,
            createdAt: Date.now(),
            expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
        };
        await addDoc(collection(db, "sessions"), session);
        
        res.status(201).json({
            message: 'Conta criada com sucesso!',
            token,
            user: { id: docRef.id, username, name }
        });
    } catch (err) {
        console.error('[Auth Register Error]', err);
        res.status(500).json({ error: 'Erro ao criar conta: ' + err.message });
    }
});

// Login de Aluno
app.post('/api/auth/login', rateLimiter(30, 60 * 1000), async (req, res) => {
    try {
        const username = sanitizeInput(req.body.username, 30).toLowerCase();
        const password = req.body.password;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
        }
        
        const q = query(collection(db, "users"), where("username", "==", username));
        const snap = await getDocs(q);
        if (snap.empty) {
            return res.status(400).json({ error: 'Usuário ou senha incorretos.' });
        }
        
        let userDoc = null;
        snap.forEach(d => { userDoc = { id: d.id, ...d.data() }; });
        
        const isValid = verifyPassword(password, userDoc.salt, userDoc.hash);
        if (!isValid) {
            return res.status(400).json({ error: 'Usuário ou senha incorretos.' });
        }
        
        const token = crypto.randomBytes(32).toString('hex');
        const session = {
            token,
            userId: userDoc.id,
            username: userDoc.username,
            name: userDoc.name,
            createdAt: Date.now(),
            expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
        };
        await addDoc(collection(db, "sessions"), session);
        
        res.json({
            message: 'Login realizado com sucesso!',
            token,
            user: { id: userDoc.id, username: userDoc.username, name: userDoc.name }
        });
    } catch (err) {
        console.error('[Auth Login Error]', err);
        res.status(500).json({ error: 'Erro ao fazer login: ' + err.message });
    }
});

// Login/Registro com Conta Google
app.post('/api/auth/google', rateLimiter(30, 60 * 1000), async (req, res) => {
    try {
        const email = sanitizeInput(req.body.email, 100).toLowerCase();
        const name = sanitizeInput(req.body.name, 50);
        const googleUid = req.body.uid; // ID do Firebase Auth
        
        if (!email || !name || !googleUid) {
            return res.status(400).json({ error: 'Dados do Google incompletos.' });
        }
        
        // Validar e-mail
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Utilize um e-mail válido.' });
        }
        
        // Verificar se usuário existe pelo e-mail
        const q = query(collection(db, "users"), where("email", "==", email));
        const snap = await getDocs(q);
        
        let userDoc = null;
        
        if (snap.empty) {
            // Se o usuário não existe, registra um novo usuário sem senha (login via Google)
            const emailPrefix = email.split('@')[0];
            let username = emailPrefix.replace(/[^a-z0-9]/g, '');
            
            // Garantir username único
            const qUserCheck = query(collection(db, "users"), where("username", "==", username));
            const snapUserCheck = await getDocs(qUserCheck);
            if (!snapUserCheck.empty) {
                username = username + crypto.randomBytes(3).toString('hex');
            }
            
            const newUser = {
                username,
                name,
                email,
                googleUid,
                createdAt: Date.now()
            };
            
            const docRef = await addDoc(collection(db, "users"), newUser);
            userDoc = { id: docRef.id, ...newUser };
            console.log(`[Google Auth] Novo usuário registrado: ${username}`);
        } else {
            // Se o usuário existe, recupera o registro
            snap.forEach(d => { userDoc = { id: d.id, ...d.data() }; });
            
            // Atualizar o googleUid se ainda não estiver associado
            if (!userDoc.googleUid) {
                await updateDoc(doc(db, "users", userDoc.id), { googleUid });
            }
            console.log(`[Google Auth] Login efetuado para usuário existente: ${userDoc.username}`);
        }
        
        // Gerar session token
        const token = crypto.randomBytes(32).toString('hex');
        const session = {
            token,
            userId: userDoc.id,
            username: userDoc.username,
            name: userDoc.name,
            createdAt: Date.now(),
            expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 dias
        };
        await addDoc(collection(db, "sessions"), session);
        
        res.json({
            message: 'Login com Google realizado com sucesso!',
            token,
            user: { id: userDoc.id, username: userDoc.username, name: userDoc.name }
        });
    } catch (err) {
        console.error('[Auth Google Error]', err);
        res.status(500).json({ error: 'Erro ao fazer login com Google: ' + err.message });
    }
});

// Obter dados do usuário logado
app.get('/api/auth/me', authenticateUser, requireAuth, (req, res) => {
    res.json({ user: req.user });
});

// --- EMAIL TEMPLATE FOR PASSWORD RECOVERY ---
function getRecoveryEmailTemplate(name, resetLink) {
    const currentYear = new Date().getFullYear();
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recuperação de Senha - Tec Senai Jardim Colorado</title>
    <style>
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: #072a59;
            color: #ffffff;
            margin: 0;
            padding: 40px 10px;
        }
        .container {
            max-width: 550px;
            margin: 0 auto;
            background-color: #13141a;
            border-radius: 20px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            overflow: hidden;
            box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4);
        }
        .header {
            background: linear-gradient(135deg, #072a59 0%, #0c4da1 100%);
            padding: 35px 20px;
            text-align: center;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .header h1 {
            margin: 0;
            font-size: 26px;
            font-weight: 800;
            letter-spacing: -0.5px;
        }
        .brand-tec {
            color: #f25424;
        }
        .brand-senai {
            color: #ffffff;
        }
        .content {
            padding: 40px 30px;
            background-color: #13141a;
        }
        .content h2 {
            font-size: 20px;
            font-weight: 700;
            color: #ffffff;
            margin-top: 0;
            margin-bottom: 20px;
        }
        .content p {
            color: #a0a5b1;
            font-size: 15px;
            line-height: 1.6;
            margin: 0 0 20px 0;
        }
        .btn-container {
            text-align: center;
            margin: 35px 0;
        }
        .btn {
            background-color: #f25424;
            color: #ffffff !important;
            text-decoration: none;
            padding: 14px 32px;
            border-radius: 50px;
            font-weight: 700;
            font-size: 15px;
            display: inline-block;
            box-shadow: 0 6px 20px rgba(242, 84, 36, 0.35);
            transition: all 0.3s ease;
        }
        .footer {
            background-color: #0c0d12;
            padding: 25px 20px;
            text-align: center;
            font-size: 12px;
            color: #6c727f;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
        }
        .link-fallback {
            word-break: break-all;
            color: #0c4da1;
            text-decoration: none;
            font-weight: 500;
        }
        .warning-text {
            font-size: 13px;
            color: #7b808c;
            border-left: 3px solid #f25424;
            padding-left: 12px;
            margin-top: 30px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1><span class="brand-tec">Tec Senai</span> <span class="brand-senai">Jardim Colorado</span></h1>
        </div>
        <div class="content">
            <h2>Redefinição de Senha</h2>
            <p>Olá, <strong>${name}</strong>,</p>
            <p>Recebemos uma solicitação para redefinir a senha da sua conta na plataforma Tec Jogos Senai.</p>
            <p>Para criar uma nova senha, clique no botão abaixo:</p>
            <div class="btn-container">
                <a href="${resetLink}" class="btn" target="_blank">Redefinir Minha Senha</a>
            </div>
            <div class="warning-text">
                Este link é válido por <strong>1 hora</strong>. Se você não solicitou essa redefinição, pode ignorar este e-mail com segurança.
            </div>
            <hr style="border: 0; border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 35px 0;">
            <p style="font-size: 12px; color: #6c727f; margin-bottom: 5px;">Se o botão não funcionar, copie e cole o link abaixo no seu navegador:</p>
            <p style="font-size: 12px; margin-top: 0;"><a href="${resetLink}" class="link-fallback" target="_blank">${resetLink}</a></p>
        </div>
        <div class="footer">
            © ${currentYear} Tec Senai Jardim Colorado. Todos os direitos reservados.
        </div>
    </div>
</body>
</html>`;
}

// Solicitar recuperação de senha
app.post('/api/auth/forgot-password', rateLimiter(10, 15 * 60 * 1000), async (req, res) => {
    try {
        const email = sanitizeInput(req.body.email, 100).toLowerCase();
        
        if (!email) {
            return res.status(400).json({ error: 'E-mail é obrigatório.' });
        }
        
        // Procurar o usuário pelo e-mail escolar
        const q = query(collection(db, "users"), where("email", "==", email));
        const snap = await getDocs(q);
        
        if (snap.empty) {
            // Retorna sucesso de qualquer forma por segurança contra enumeração de e-mails
            return res.json({ message: 'Se o e-mail estiver cadastrado, as instruções foram enviadas para seu e-mail escolar.' });
        }
        
        let userDoc = null;
        snap.forEach(d => { userDoc = { id: d.id, ...d.data() }; });
        
        // Limpar tokens antigos desse usuário antes de criar um novo
        try {
            const qOld = query(collection(db, "password_resets"), where("userId", "==", userDoc.id));
            const oldResets = await getDocs(qOld);
            oldResets.forEach(async (oldDoc) => {
                await deleteDoc(doc(db, "password_resets", oldDoc.id));
            });
        } catch (_) {}
        
        // Gerar token de redefinição
        const token = crypto.randomBytes(32).toString('hex');
        const resetEntry = {
            token,
            userId: userDoc.id,
            email: userDoc.email,
            expiresAt: Date.now() + 60 * 60 * 1000 // 1 hora
        };
        
        await addDoc(collection(db, "password_resets"), resetEntry);
        
        // Gerar link de recuperação dinâmico com base na origem da requisição
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const resetLink = `${protocol}://${host}/reset-password.html?token=${token}`;
        
        console.log(`\n========================================`);
        console.log(`[PASSWORD RESET] Solicitação para usuário: ${userDoc.username}`);
        console.log(`Link: ${resetLink}`);
        console.log(`========================================\n`);

        // Enviar e-mail caso SMTP esteja configurado
        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
            const mailOptions = {
                from: process.env.SMTP_FROM || `"Tec Senai Jardim Colorado" <${process.env.SMTP_USER}>`,
                to: userDoc.email,
                subject: 'Recuperação de Senha - Tec Senai Jardim Colorado',
                html: getRecoveryEmailTemplate(userDoc.name || userDoc.username, resetLink)
            };

            try {
                await transporter.sendMail(mailOptions);
                console.log(`[SMTP] E-mail de redefinição enviado com sucesso para: ${userDoc.email}`);
            } catch (mailErr) {
                console.error('[SMTP Error] Falha ao enviar e-mail:', mailErr);
                return res.status(500).json({ error: 'Erro ao enviar o e-mail de recuperação. Por favor, tente novamente mais tarde.' });
            }
        } else {
            console.warn(`[SMTP Warning] SMTP não configurado. E-mail de redefinição não foi enviado (link logado no console acima).`);
        }
        
        res.json({ message: 'Se o e-mail estiver cadastrado, as instruções foram enviadas para seu e-mail escolar.' });
    } catch (err) {
        console.error('[Auth Forgot Error]', err);
        res.status(500).json({ error: 'Erro ao processar solicitação: ' + err.message });
    }
});

// Redefinir a senha usando o token
app.post('/api/auth/reset-password', rateLimiter(10, 60 * 1000), async (req, res) => {
    try {
        const token = sanitizeInput(req.body.token, 100);
        const newPassword = req.body.newPassword;
        
        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Token e nova senha são obrigatórios.' });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
        }
        
        // Verificar se o token existe e é válido
        const q = query(collection(db, "password_resets"), where("token", "==", token));
        const snap = await getDocs(q);
        
        if (snap.empty) {
            return res.status(400).json({ error: 'Link de redefinição inválido ou expirado.' });
        }
        
        let resetDocVal = null;
        snap.forEach(d => { resetDocVal = { id: d.id, ...d.data() }; });
        
        if (resetDocVal.expiresAt < Date.now()) {
            try { await deleteDoc(doc(db, "password_resets", resetDocVal.id)); } catch (_) {}
            return res.status(400).json({ error: 'Este link de redefinição de senha já expirou.' });
        }
        
        // Gerar novo salt e hash para a nova senha
        const { salt, hash } = hashPassword(newPassword);
        
        // Atualizar o documento do usuário
        await updateDoc(doc(db, "users", resetDocVal.userId), { salt, hash });
        console.log(`[Firestore] Senha atualizada para o usuário com ID: ${resetDocVal.userId}`);
        
        // Deletar o token de redefinição utilizado
        await deleteDoc(doc(db, "password_resets", resetDocVal.id));
        
        res.json({ message: 'Senha redefinida com sucesso! Você já pode fazer login.' });
    } catch (err) {
        console.error('[Auth Reset Error]', err);
        res.status(500).json({ error: 'Erro ao redefinir a senha: ' + err.message });
    }
});

// Headers necessários para jogos Unity WebGL e Godot (SharedArrayBuffer)
app.use('/games', (req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    next();
});

app.use((req, res, next) => {
    // Evita que a pasta 'public' sirva os arquivos de /games e /sites diretamente sem passar pelos cabeçalhos corretos e cache
    if (req.url.startsWith('/games/') || req.url.startsWith('/sites/')) {
        return next();
    }
    express.static('public')(req, res, next);
});

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

// Resolve caminhos ignorando diferenças de maiúsculas/minúsculas de forma recursiva
function resolveCaseInsensitivePath(basePath, relativePath) {
    const segments = relativePath.split(/[/\\]/).filter(Boolean);
    let currentPath = basePath;
    
    for (const segment of segments) {
        if (!fs.existsSync(currentPath)) return null;
        
        try {
            const stat = fs.statSync(currentPath);
            if (!stat.isDirectory()) return null;
            
            const files = fs.readdirSync(currentPath);
            const match = files.find(f => f.toLowerCase() === segment.toLowerCase());
            if (!match) return null;
            
            currentPath = path.join(currentPath, match);
        } catch (err) {
            return null;
        }
    }
    
    return currentPath;
}

// Converte caminhos absolutos (ex: /style.css) para relativos em arquivos HTML, CSS e JS extraídos,
// ignorando as rotas de sistema conhecidas como /games, /sites, /api, /health, /professores.html, /favicon.ico.
function convertAbsolutePathsToRelative(dirPath) {
    const globalPrefixes = ['/games', '/sites', '/api', '/health', '/professores.html', '/favicon.ico'];
    
    function walk(currentDir) {
        if (!fs.existsSync(currentDir)) return;
        const items = fs.readdirSync(currentDir);
        for (const item of items) {
            const fullPath = path.join(currentDir, item);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    walk(fullPath);
                } else {
                    const ext = path.extname(item).toLowerCase();
                    if (['.html', '.css', '.js'].includes(ext)) {
                        let content = fs.readFileSync(fullPath, 'utf8');
                        let modified = false;
                        
                        // Regex para caminhos em aspas (HTML, JS, CSS)
                        content = content.replace(/(["'`])(\/[^"'`\s]+)\1/g, (match, quote, pathVal) => {
                            if (pathVal.startsWith('//')) return match; // ignora protocolo relativo
                            
                            const shouldPreserve = globalPrefixes.some(prefix => 
                                pathVal === prefix || pathVal.startsWith(prefix + '/')
                            );
                            
                            if (shouldPreserve) return match;
                            
                            const relativePath = pathVal.substring(1);
                            modified = true;
                            return `${quote}${relativePath}${quote}`;
                        });
                        
                        // Regex para url('/...') no CSS
                        content = content.replace(/url\(\s*["']?(\/[^)]+)["']?\s*\)/g, (match, pathVal) => {
                            if (pathVal.startsWith('//')) return match;
                            
                            const shouldPreserve = globalPrefixes.some(prefix => 
                                pathVal === prefix || pathVal.startsWith(prefix + '/')
                            );
                            
                            if (shouldPreserve) return match;
                            
                            const relativePath = pathVal.substring(1);
                            modified = true;
                            
                            if (pathVal.startsWith("'") || pathVal.startsWith('"')) {
                                const quote = pathVal[0];
                                return `url(${quote}${relativePath.substring(1)}${quote})`;
                            }
                            return `url(${relativePath})`;
                        });
                        
                        if (modified) {
                            fs.writeFileSync(fullPath, content, 'utf8');
                            console.log(`[Path Fix] Converted absolute paths in: ${fullPath}`);
                        }
                    }
                }
            } catch (err) {
                console.warn(`[Path Fix Warning] Failed to process ${fullPath}:`, err.message);
            }
        }
    }
    
    walk(dirPath);
}

// Middleware de arquivos estáticos com suporte a case-insensitive
function caseInsensitiveStatic(baseDir) {
    return (req, res, next) => {
        let decodedUrl;
        try {
            decodedUrl = decodeURIComponent(req.url);
        } catch (e) {
            decodedUrl = req.url;
        }
        
        const cleanPath = decodedUrl.split('?')[0];
        const exactPath = path.join(baseDir, cleanPath);
        
        if (fs.existsSync(exactPath)) {
            return next();
        }
        
        const resolvedPath = resolveCaseInsensitivePath(baseDir, cleanPath);
        if (resolvedPath) {
            const relativeResolved = path.relative(baseDir, resolvedPath);
            const normalizedRelative = '/' + relativeResolved.replace(/\\/g, '/');
            
            console.log(`[Case Fix] Resolved case mismatch: ${req.url} -> ${normalizedRelative}`);
            
            const queryIndex = req.url.indexOf('?');
            const queryString = queryIndex !== -1 ? req.url.substring(queryIndex) : '';
            
            req.url = normalizedRelative + queryString;
        }
        
        next();
    };
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

            // ── Injeta mocks de módulos específicos do Windows ───────────────
            // Estes módulos não existem no Pyodide (browser), mas são comuns
            // em jogos feitos no Windows. Os mocks silenciam ImportError.
            await pyodide.runPythonAsync(\`
import sys, types

def _mk(name, **attrs):
    m = types.ModuleType(name)
    for k, v in attrs.items(): setattr(m, k, v)
    sys.modules[name] = m

_noop = lambda *a, **kw: None

# winsound — sons do sistema Windows
_mk('winsound',
    Beep=_noop, PlaySound=_noop, MessageBeep=_noop,
    SND_FILENAME=0x20000, SND_ALIAS=0x10000, SND_LOOP=0x8,
    SND_MEMORY=0x4,       SND_NODEFAULT=0x2, SND_NOSTOP=0x10,
    SND_NOWAIT=0x2000,    SND_PURGE=0x40,    SND_ASYNC=0x1,
    SND_APPLICATION=0x80,
)

# winreg — registro do Windows
_mk('winreg',
    OpenKey=_noop, CloseKey=_noop, QueryValueEx=lambda *a,**k: ('',0),
    SetValueEx=_noop, CreateKey=_noop, DeleteKey=_noop,
    HKEY_CURRENT_USER=0x80000001, HKEY_LOCAL_MACHINE=0x80000002,
    REG_SZ=1, REG_DWORD=4,
)

# msvcrt — E/S de console do Windows
_mk('msvcrt',
    getch=lambda: b'', kbhit=lambda: False, getwch=lambda: '',
    putch=_noop, putwch=_noop,
)

del _mk, _noop
\`);
            // ─────────────────────────────────────────────────────────────────

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
            // Corrigir caminhos absolutos no cache local de jogos
            convertAbsolutePathsToRelative(localGamePath);

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
app.use('/games', caseInsensitiveStatic(GAMES_FOLDER));
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
            // Corrigir caminhos absolutos no cache local de sites
            convertAbsolutePathsToRelative(localSitePath);

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
app.use('/sites', caseInsensitiveStatic(SITES_FOLDER));
app.use('/sites', express.static(SITES_FOLDER));

app.post('/upload', rateLimiter(50, 60 * 60 * 1000), authenticateUser, uploadGame.fields([{ name: 'gameFile', maxCount: 1 }, { name: 'coverImage', maxCount: 1 }]), async (req, res) => {
    const file = req.files && req.files['gameFile'] ? req.files['gameFile'][0] : null;
    const coverFile = req.files && req.files['coverImage'] ? req.files['coverImage'][0] : null;

    try {
        const gameTitle = sanitizeInput(req.body.gameTitle, 50);
        const authorName = sanitizeInput(req.body.authorName, 50);
        const gameCategory = sanitizeInput(req.body.gameCategory, 30);
        const city = sanitizeInput(req.body.city, 30);
        const school = sanitizeInput(req.body.school, 100);
        const studentClass = sanitizeInput(req.body.studentClass, 100);
        const teacher = sanitizeInput(req.body.teacher, 30);

        if (!file) {
            if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        if (!gameTitle || !authorName || !gameCategory || !city || !school || !studentClass || !teacher) {
            try { fs.unlinkSync(file.path); } catch (_) {}
            if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
            return res.status(400).json({ error: 'Campos obrigatórios inválidos ou vazios.' });
        }

        // Validate cover
        if (coverFile) {
            const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            const ext = path.extname(coverFile.originalname).toLowerCase();
            const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
            if (!allowedMimes.includes(coverFile.mimetype) || !allowedExts.includes(ext)) {
                try { fs.unlinkSync(file.path); } catch (_) {}
                try { fs.unlinkSync(coverFile.path); } catch (_) {}
                return res.status(400).json({ error: 'A imagem de capa deve ser um formato de imagem válido (JPG, PNG, GIF, WEBP).' });
            }
            if (coverFile.size > 5 * 1024 * 1024) {
                try { fs.unlinkSync(file.path); } catch (_) {}
                try { fs.unlinkSync(coverFile.path); } catch (_) {}
                return res.status(400).json({ error: 'A imagem de capa não deve exceder 5 MB.' });
            }
        }

        // Validate game file extension and size bounds
        const gameExt = path.extname(file.originalname).toLowerCase();
        if (!['.zip', '.html', '.py'].includes(gameExt)) {
            try { fs.unlinkSync(file.path); } catch (_) {}
            if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
            return res.status(400).json({ error: 'Arquivo inválido. Formatos permitidos: .zip, .html, .py' });
        }

        if (gameExt === '.html' || gameExt === '.py') {
            if (file.size > 5 * 1024 * 1024) {
                try { fs.unlinkSync(file.path); } catch (_) {}
                if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
                return res.status(400).json({ error: 'Arquivos individuais (.html, .py) não devem exceder 5 MB.' });
            }
        } else if (gameExt === '.zip') {
            if (file.size > 100 * 1024 * 1024) {
                try { fs.unlinkSync(file.path); } catch (_) {}
                if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
                return res.status(400).json({ error: 'O arquivo ZIP do jogo não deve exceder 100 MB.' });
            }
            // Defesas Zip Bomb / Zip Slip / Malware
            try {
                validateZipArchive(file.path, 150 * 1024 * 1024, 1500);
            } catch (zipErr) {
                try { fs.unlinkSync(file.path); } catch (_) {}
                if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
                return res.status(400).json({ error: `ZIP inválido: ${zipErr.message}` });
            }
        }

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
        }

        try { fs.unlinkSync(file.path); } catch (_) {}

        if (!indexHtmlPath || !fs.existsSync(path.join(indexHtmlPath, indexInfo ? indexInfo.fileName : 'index.html'))) {
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

        // Corrigir caminhos absolutos nos arquivos carregados
        convertAbsolutePathsToRelative(localGamePath);

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
                console.log(`[Storage] Cover image uploaded for game ${gameId}: ${coverUrl.substring(0, 60)}...`);
            } catch (coverErr) {
                console.error('[Error] Failed to upload cover image to Firebase Storage:', coverErr.message);
            } finally {
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

        if (req.user) {
            newGame.ownerId = req.user.userId;
            newGame.ownerName = req.user.name;
        }
        
        // Save with explicit document ID for consistency
        const docRef = await addDoc(collection(db, "games"), newGame);
        console.log(`[Firestore] Game saved with docId: ${docRef.id}, gameId: ${gameId}`);

        res.status(200).json({ message: 'Jogo enviado com sucesso!', game: { ...newGame, docId: docRef.id } });
    } catch (error) {
        if (file) try { fs.unlinkSync(file.path); } catch (_) {}
        if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
        console.error('[Error] Upload failed:', error);
        res.status(500).json({ error: 'Erro ao processar o jogo: ' + error.message });
    }
});

// Atualizar / Sobrescrever Jogo
app.post('/api/games/:gameId/update', rateLimiter(15, 60 * 1000), authenticateUser, requireAuth, uploadGame.fields([{ name: 'gameFile', maxCount: 1 }, { name: 'coverImage', maxCount: 1 }]), async (req, res) => {
    const gameId = req.params.gameId;
    const file = req.files && req.files['gameFile'] ? req.files['gameFile'][0] : null;
    const coverFile = req.files && req.files['coverImage'] ? req.files['coverImage'][0] : null;

    try {
        // Find document in Firestore
        const q = query(collection(db, "games"));
        const snapshot = await getDocs(q);
        let targetDocId = null;
        let gameData = null;
        
        snapshot.forEach((docSnap) => {
            if (docSnap.id === gameId || String(docSnap.data().id) === String(gameId)) {
                targetDocId = docSnap.id;
                gameData = docSnap.data();
            }
        });
        
        if (!targetDocId) {
            if (file) try { fs.unlinkSync(file.path); } catch (_) {}
            if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
            return res.status(404).json({ error: 'Jogo não encontrado' });
        }
        
        // Authorization check: User must be owner
        if (gameData.ownerId !== req.user.userId) {
            if (file) try { fs.unlinkSync(file.path); } catch (_) {}
            if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
            return res.status(403).json({ error: 'Você não tem permissão para editar este jogo.' });
        }

        // Sanitize input
        const gameTitle = sanitizeInput(req.body.gameTitle, 50);
        const gameCategory = sanitizeInput(req.body.gameCategory, 30);
        const city = sanitizeInput(req.body.city, 30);
        const school = sanitizeInput(req.body.school, 100);
        const studentClass = sanitizeInput(req.body.studentClass, 100);
        const teacher = sanitizeInput(req.body.teacher, 30);
        
        if (!gameTitle || !gameCategory || !city || !school || !studentClass || !teacher) {
            if (file) try { fs.unlinkSync(file.path); } catch (_) {}
            if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
            return res.status(400).json({ error: 'Campos obrigatórios vazios.' });
        }

        const updates = {
            title: gameTitle,
            category: gameCategory,
            city: city || null,
            school: school || null,
            studentClass: studentClass || null,
            teacher: teacher || null,
        };

        const localGamePath = path.join(GAMES_FOLDER, gameId);
        let storageFileRef = ref(storage, `games/${gameId}.zip`);

        // Handle replacement of ZIP/HTML/Python file
        if (file) {
            // Validate extension and size
            const gameExt = path.extname(file.originalname).toLowerCase();
            if (!['.zip', '.html', '.py'].includes(gameExt)) {
                try { fs.unlinkSync(file.path); } catch (_) {}
                if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
                return res.status(400).json({ error: 'Arquivo inválido. Formatos permitidos: .zip, .html, .py' });
            }

            if (gameExt === '.html' || gameExt === '.py') {
                if (file.size > 5 * 1024 * 1024) {
                    try { fs.unlinkSync(file.path); } catch (_) {}
                    if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
                    return res.status(400).json({ error: 'Arquivos individuais (.html, .py) não devem exceder 5 MB.' });
                }
            } else if (gameExt === '.zip') {
                if (file.size > 100 * 1024 * 1024) {
                    try { fs.unlinkSync(file.path); } catch (_) {}
                    if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
                    return res.status(400).json({ error: 'O arquivo ZIP do jogo não deve exceder 100 MB.' });
                }
                try {
                    validateZipArchive(file.path, 150 * 1024 * 1024, 1500);
                } catch (zipErr) {
                    try { fs.unlinkSync(file.path); } catch (_) {}
                    if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
                    return res.status(400).json({ error: `ZIP inválido: ${zipErr.message}` });
                }
            }

            // Clean old local extraction cache folder to write fresh files
            if (fs.existsSync(localGamePath)) {
                try { fs.rmSync(localGamePath, { recursive: true, force: true }); } catch (_) {}
            }
            try { fs.mkdirSync(localGamePath, { recursive: true }); } catch (_) {}

            let indexHtmlPath = null;
            let indexInfo = null;
            let gameType = 'html';

            if (file.originalname.toLowerCase().endsWith('.zip')) {
                const zip = new AdmZip(file.path);
                zip.extractAllTo(localGamePath, true);
                indexInfo = findIndexHtml(localGamePath);
                if (indexInfo) {
                    indexHtmlPath = indexInfo.dirPath;
                } else {
                    const pythonInfo = findMainPython(localGamePath);
                    if (pythonInfo) {
                        reorganizeGameFiles(localGamePath, pythonInfo.dirPath);
                        const runnerHtml = generatePygbagRunner(pythonInfo.fileName, localGamePath);
                        fs.writeFileSync(path.join(localGamePath, 'index.html'), runnerHtml);
                        indexHtmlPath = localGamePath;
                        indexInfo = { dirPath: localGamePath, fileName: 'index.html' };
                        gameType = 'python';
                    }
                }
                const repackZip = new AdmZip();
                repackZip.addLocalFolder(localGamePath);
                const repackBuffer = repackZip.toBuffer();
                await uploadBytes(storageFileRef, repackBuffer, { contentType: 'application/zip' });
            } else if (file.originalname.toLowerCase().endsWith('.html')) {
                fs.copyFileSync(file.path, path.join(localGamePath, 'index.html'));
                indexHtmlPath = localGamePath;
                const zipOut = new AdmZip();
                zipOut.addLocalFile(file.path);
                const outBuffer = zipOut.toBuffer();
                await uploadBytes(storageFileRef, outBuffer, { contentType: 'application/zip' });
            } else if (file.originalname.toLowerCase().endsWith('.py')) {
                fs.copyFileSync(file.path, path.join(localGamePath, file.originalname));
                const runnerHtml = generatePygbagRunner(file.originalname, localGamePath);
                fs.writeFileSync(path.join(localGamePath, 'index.html'), runnerHtml);
                indexHtmlPath = localGamePath;
                indexInfo = { dirPath: localGamePath, fileName: 'index.html' };
                gameType = 'python';

                const zipOut = new AdmZip();
                zipOut.addLocalFolder(localGamePath);
                const outBuffer = zipOut.toBuffer();
                await uploadBytes(storageFileRef, outBuffer, { contentType: 'application/zip' });
            }

            try { fs.unlinkSync(file.path); } catch (_) {}

            if (!indexHtmlPath || !fs.existsSync(path.join(indexHtmlPath, indexInfo ? indexInfo.fileName : 'index.html'))) {
                return res.status(400).json({ error: 'Nenhum ponto de entrada encontrado (.html/.py).' });
            }

            reorganizeGameFiles(localGamePath, indexHtmlPath);
            if (indexInfo && indexInfo.fileName !== 'index.html') {
                const originalHtml = path.join(localGamePath, indexInfo.fileName);
                const targetHtml = path.join(localGamePath, 'index.html');
                if (fs.existsSync(originalHtml)) fs.renameSync(originalHtml, targetHtml);
            }
            convertAbsolutePathsToRelative(localGamePath);

            updates.gameType = gameType;
            console.log(`[Update] Replaced game file for ${gameId}. Type: ${gameType}`);
        }

        // Handle replacement of Cover Image
        if (coverFile) {
            const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            const ext = path.extname(coverFile.originalname).toLowerCase();
            const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
            if (!allowedMimes.includes(coverFile.mimetype) || !allowedExts.includes(ext)) {
                try { fs.unlinkSync(coverFile.path); } catch (_) {}
                return res.status(400).json({ error: 'A imagem de capa deve ser um formato válido.' });
            }
            if (coverFile.size > 5 * 1024 * 1024) {
                try { fs.unlinkSync(coverFile.path); } catch (_) {}
                return res.status(400).json({ error: 'A imagem de capa não deve exceder 5 MB.' });
            }

            try {
                // Delete previous cover if exists from firebase storage
                if (gameData.coverUrl) {
                    try {
                        const parsedUrl = new URL(gameData.coverUrl);
                        const oldCoverPath = decodeURIComponent(parsedUrl.pathname.split('/o/')[1].split('?')[0]);
                        const oldCoverRef = ref(storage, oldCoverPath);
                        await deleteObject(oldCoverRef);
                    } catch (delCoverErr) {
                        console.warn('[Update] Could not delete old cover (non-critical):', delCoverErr.message);
                    }
                }
                
                const coverExt = path.extname(coverFile.originalname) || '.jpg';
                const coverStorageRef = ref(storage, `covers/${gameId}${coverExt}`);
                const coverBuffer = fs.readFileSync(coverFile.path);
                const coverMime = coverFile.mimetype || 'image/jpeg';
                await uploadBytes(coverStorageRef, coverBuffer, { contentType: coverMime });
                const coverUrl = await getDownloadURL(coverStorageRef);
                updates.coverUrl = coverUrl;
                console.log(`[Update] Cover image replaced for game ${gameId}: ${coverUrl}`);
            } catch (coverErr) {
                console.error('[Update Error] Cover upload failed:', coverErr.message);
            } finally {
                try { fs.unlinkSync(coverFile.path); } catch (_) {}
            }
        }

        // Update Firestore document
        await updateDoc(doc(db, "games", targetDocId), updates);
        console.log(`[Update] Game ${gameId} successfully updated in Firestore.`);

        res.json({ message: 'Jogo atualizado com sucesso!', game: { ...gameData, ...updates } });

    } catch (error) {
        if (file) try { fs.unlinkSync(file.path); } catch (_) {}
        if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
        console.error('[Update Error] Failed to update game:', error);
        res.status(500).json({ error: 'Erro ao atualizar o jogo: ' + error.message });
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

app.post('/upload-site', rateLimiter(50, 60 * 60 * 1000), authenticateUser, uploadSite.fields([{ name: 'gameFile', maxCount: 1 }, { name: 'coverImage', maxCount: 1 }]), async (req, res) => {
    const file = req.files && req.files['gameFile'] ? req.files['gameFile'][0] : null;
    const coverFile = req.files && req.files['coverImage'] ? req.files['coverImage'][0] : null;

    try {
        const gameTitle = sanitizeInput(req.body.gameTitle, 50);
        const authorName = sanitizeInput(req.body.authorName, 50);
        const gameCategory = sanitizeInput(req.body.gameCategory, 30);
        const city = sanitizeInput(req.body.city, 30);
        const school = sanitizeInput(req.body.school, 100);
        const studentClass = sanitizeInput(req.body.studentClass, 100);
        const teacher = sanitizeInput(req.body.teacher, 30);

        if (!file) {
            if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        if (!gameTitle || !authorName || !gameCategory || !city || !school || !studentClass || !teacher) {
            try { fs.unlinkSync(file.path); } catch (_) {}
            if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
            return res.status(400).json({ error: 'Campos obrigatórios inválidos ou vazios.' });
        }

        // Validate cover
        if (coverFile) {
            const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            const ext = path.extname(coverFile.originalname).toLowerCase();
            const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
            if (!allowedMimes.includes(coverFile.mimetype) || !allowedExts.includes(ext)) {
                try { fs.unlinkSync(file.path); } catch (_) {}
                try { fs.unlinkSync(coverFile.path); } catch (_) {}
                return res.status(400).json({ error: 'A imagem de capa deve ser um formato de imagem válido (JPG, PNG, GIF, WEBP).' });
            }
            if (coverFile.size > 5 * 1024 * 1024) {
                try { fs.unlinkSync(file.path); } catch (_) {}
                try { fs.unlinkSync(coverFile.path); } catch (_) {}
                return res.status(400).json({ error: 'A imagem de capa não deve exceder 5 MB.' });
            }
        }

        // Validate site file
        const gameExt = path.extname(file.originalname).toLowerCase();
        if (!['.zip', '.html'].includes(gameExt)) {
            try { fs.unlinkSync(file.path); } catch (_) {}
            if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
            return res.status(400).json({ error: 'Arquivo inválido. Formatos permitidos para sites: .zip, .html' });
        }

        if (gameExt === '.html') {
            if (file.size > 5 * 1024 * 1024) {
                try { fs.unlinkSync(file.path); } catch (_) {}
                if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
                return res.status(400).json({ error: 'Arquivos HTML individuais não devem exceder 5 MB.' });
            }
        } else if (gameExt === '.zip') {
            if (file.size > 50 * 1024 * 1024) {
                try { fs.unlinkSync(file.path); } catch (_) {}
                if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
                return res.status(400).json({ error: 'O arquivo ZIP do site não deve exceder 50 MB.' });
            }
            // Defesas Zip Bomb / Zip Slip / Malware
            try {
                validateZipArchive(file.path, 80 * 1024 * 1024, 1000);
            } catch (zipErr) {
                try { fs.unlinkSync(file.path); } catch (_) {}
                if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
                return res.status(400).json({ error: `ZIP inválido: ${zipErr.message}` });
            }
        }

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

        try { fs.unlinkSync(file.path); } catch (_) {}

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

        // Corrigir caminhos absolutos nos arquivos de sites carregados
        convertAbsolutePathsToRelative(localSitePath);

        let coverUrl = null;
        if (coverFile) {
            try {
                const coverExt = path.extname(coverFile.originalname) || '.jpg';
                const coverStorageRef = ref(storage, `covers/sites/${siteId}${coverExt}`);
                const coverBuffer = fs.readFileSync(coverFile.path);
                const coverMime = coverFile.mimetype || 'image/jpeg';
                await uploadBytes(coverStorageRef, coverBuffer, { contentType: coverMime });
                coverUrl = await getDownloadURL(coverStorageRef);
                console.log(`[Storage] Cover image uploaded for site ${siteId}`);
            } catch (coverErr) {
                console.error('[Error] Failed to upload site cover:', coverErr.message);
            } finally {
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

        if (req.user) {
            newSite.ownerId = req.user.userId;
            newSite.ownerName = req.user.name;
        }

        const docRef = await addDoc(collection(db, "sites"), newSite);
        console.log(`[Firestore] Site saved with docId: ${docRef.id}, siteId: ${siteId}`);

        res.status(200).json({ message: 'Site enviado com sucesso!', site: { ...newSite, docId: docRef.id } });
    } catch (error) {
        if (file) try { fs.unlinkSync(file.path); } catch (_) {}
        if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
        console.error('[Error] Site upload failed:', error);
        res.status(500).json({ error: 'Erro ao processar o site: ' + error.message });
    }
});

// Atualizar / Sobrescrever Site
app.post('/api/sites/:siteId/update', rateLimiter(15, 60 * 1000), authenticateUser, requireAuth, uploadSite.fields([{ name: 'gameFile', maxCount: 1 }, { name: 'coverImage', maxCount: 1 }]), async (req, res) => {
    const siteId = req.params.siteId;
    const file = req.files && req.files['gameFile'] ? req.files['gameFile'][0] : null;
    const coverFile = req.files && req.files['coverImage'] ? req.files['coverImage'][0] : null;

    try {
        // Find document in Firestore
        const q = query(collection(db, "sites"));
        const snapshot = await getDocs(q);
        let targetDocId = null;
        let siteData = null;
        
        snapshot.forEach((docSnap) => {
            if (docSnap.id === siteId || String(docSnap.data().id) === String(siteId)) {
                targetDocId = docSnap.id;
                siteData = docSnap.data();
            }
        });
        
        if (!targetDocId) {
            if (file) try { fs.unlinkSync(file.path); } catch (_) {}
            if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
            return res.status(404).json({ error: 'Site não encontrado' });
        }
        
        // Authorization check: User must be owner
        if (siteData.ownerId !== req.user.userId) {
            if (file) try { fs.unlinkSync(file.path); } catch (_) {}
            if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
            return res.status(403).json({ error: 'Você não tem permissão para editar este site.' });
        }

        // Sanitize input
        const gameTitle = sanitizeInput(req.body.gameTitle, 50);
        const gameCategory = sanitizeInput(req.body.gameCategory, 30);
        const city = sanitizeInput(req.body.city, 30);
        const school = sanitizeInput(req.body.school, 100);
        const studentClass = sanitizeInput(req.body.studentClass, 100);
        const teacher = sanitizeInput(req.body.teacher, 30);
        
        if (!gameTitle || !gameCategory || !city || !school || !studentClass || !teacher) {
            if (file) try { fs.unlinkSync(file.path); } catch (_) {}
            if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
            return res.status(400).json({ error: 'Campos obrigatórios vazios.' });
        }

        const updates = {
            title: gameTitle,
            category: gameCategory,
            city: city || null,
            school: school || null,
            studentClass: studentClass || null,
            teacher: teacher || null,
        };

        const localSitePath = path.join(SITES_FOLDER, siteId);
        let storageFileRef = ref(storage, `sites/${siteId}.zip`);

        // Handle replacement of ZIP/HTML file
        if (file) {
            // Validate extension and size
            const gameExt = path.extname(file.originalname).toLowerCase();
            if (!['.zip', '.html'].includes(gameExt)) {
                try { fs.unlinkSync(file.path); } catch (_) {}
                if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
                return res.status(400).json({ error: 'Arquivo inválido. Formatos permitidos: .zip, .html' });
            }

            if (gameExt === '.html') {
                if (file.size > 5 * 1024 * 1024) {
                    try { fs.unlinkSync(file.path); } catch (_) {}
                    if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
                    return res.status(400).json({ error: 'Arquivos HTML individuais não devem exceder 5 MB.' });
                }
            } else if (gameExt === '.zip') {
                if (file.size > 50 * 1024 * 1024) {
                    try { fs.unlinkSync(file.path); } catch (_) {}
                    if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
                    return res.status(400).json({ error: 'O arquivo ZIP do site não deve exceder 50 MB.' });
                }
                try {
                    validateZipArchive(file.path, 80 * 1024 * 1024, 1000);
                } catch (zipErr) {
                    try { fs.unlinkSync(file.path); } catch (_) {}
                    if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
                    return res.status(400).json({ error: `ZIP inválido: ${zipErr.message}` });
                }
            }

            // Clean old local extraction cache folder to write fresh files
            if (fs.existsSync(localSitePath)) {
                try { fs.rmSync(localSitePath, { recursive: true, force: true }); } catch (_) {}
            }
            try { fs.mkdirSync(localSitePath, { recursive: true }); } catch (_) {}

            let indexHtmlPath = null;
            let indexInfo = null;

            if (file.originalname.toLowerCase().endsWith('.zip')) {
                const zip = new AdmZip(file.path);
                zip.extractAllTo(localSitePath, true);
                indexInfo = findIndexHtml(localSitePath);
                if (indexInfo) indexHtmlPath = indexInfo.dirPath;

                const fileBuffer = fs.readFileSync(file.path);
                await uploadBytes(storageFileRef, fileBuffer, { contentType: 'application/zip' });
            } else if (file.originalname.toLowerCase().endsWith('.html')) {
                fs.copyFileSync(file.path, path.join(localSitePath, 'index.html'));
                indexHtmlPath = localSitePath;
                const zipOut = new AdmZip();
                zipOut.addLocalFile(file.path);
                const outBuffer = zipOut.toBuffer();
                await uploadBytes(storageFileRef, outBuffer, { contentType: 'application/zip' });
            }

            try { fs.unlinkSync(file.path); } catch (_) {}

            if (!indexHtmlPath || !fs.existsSync(path.join(indexHtmlPath, indexInfo ? indexInfo.fileName : 'index.html'))) {
                return res.status(400).json({ error: 'Nenhum ponto de entrada encontrado (index.html).' });
            }

            reorganizeGameFiles(localSitePath, indexHtmlPath);
            if (indexInfo && indexInfo.fileName !== 'index.html') {
                const originalHtml = path.join(localSitePath, indexInfo.fileName);
                const targetHtml = path.join(localSitePath, 'index.html');
                if (fs.existsSync(originalHtml)) fs.renameSync(originalHtml, targetHtml);
            }
            convertAbsolutePathsToRelative(localSitePath);
            console.log(`[Update] Replaced site file for ${siteId}.`);
        }

        // Handle replacement of Cover Image
        if (coverFile) {
            const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            const ext = path.extname(coverFile.originalname).toLowerCase();
            const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
            if (!allowedMimes.includes(coverFile.mimetype) || !allowedExts.includes(ext)) {
                try { fs.unlinkSync(coverFile.path); } catch (_) {}
                return res.status(400).json({ error: 'A imagem de capa deve ser um formato válido.' });
            }
            if (coverFile.size > 5 * 1024 * 1024) {
                try { fs.unlinkSync(coverFile.path); } catch (_) {}
                return res.status(400).json({ error: 'A imagem de capa não deve exceder 5 MB.' });
            }

            try {
                // Delete previous cover if exists from firebase storage
                if (siteData.coverUrl) {
                    try {
                        const parsedUrl = new URL(siteData.coverUrl);
                        const oldCoverPath = decodeURIComponent(parsedUrl.pathname.split('/o/')[1].split('?')[0]);
                        const oldCoverRef = ref(storage, oldCoverPath);
                        await deleteObject(oldCoverRef);
                    } catch (delCoverErr) {
                        console.warn('[Update] Could not delete old site cover (non-critical):', delCoverErr.message);
                    }
                }
                
                const coverExt = path.extname(coverFile.originalname) || '.jpg';
                const coverStorageRef = ref(storage, `covers/sites/${siteId}${coverExt}`);
                const coverBuffer = fs.readFileSync(coverFile.path);
                const coverMime = coverFile.mimetype || 'image/jpeg';
                await uploadBytes(coverStorageRef, coverBuffer, { contentType: coverMime });
                const coverUrl = await getDownloadURL(coverStorageRef);
                updates.coverUrl = coverUrl;
                console.log(`[Update] Cover image replaced for site ${siteId}: ${coverUrl}`);
            } catch (coverErr) {
                console.error('[Update Error] Site cover upload failed:', coverErr.message);
            } finally {
                try { fs.unlinkSync(coverFile.path); } catch (_) {}
            }
        }

        // Update Firestore document
        await updateDoc(doc(db, "sites", targetDocId), updates);
        console.log(`[Update] Site ${siteId} successfully updated in Firestore.`);

        res.json({ message: 'Site atualizado com sucesso!', site: { ...siteData, ...updates } });

    } catch (error) {
        if (file) try { fs.unlinkSync(file.path); } catch (_) {}
        if (coverFile) try { fs.unlinkSync(coverFile.path); } catch (_) {}
        console.error('[Update Error] Failed to update site:', error);
        res.status(500).json({ error: 'Erro ao atualizar o site: ' + error.message });
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

// Incrementa contador de visualizações de sites
app.post('/api/sites/:siteId/view', rateLimiter(30, 60 * 1000), async (req, res) => {
    try {
        const siteId = req.params.siteId;
        const q = query(collection(db, 'sites'));
        const snap = await getDocs(q);
        let targetDocId = null;
        snap.forEach(d => {
            if (d.id === siteId || String(d.data().id) === String(siteId)) targetDocId = d.id;
        });
        if (!targetDocId) return res.status(404).json({ error: 'Site não encontrado.' });
        await updateDoc(doc(db, 'sites', targetDocId), { views: increment(1) });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rate a site (1-5 stars)
app.post('/api/sites/:siteId/rate', rateLimiter(20, 60 * 1000), async (req, res) => {
    try {
        const siteId = req.params.siteId;
        const rating = parseInt(req.body.rating);
        if (isNaN(rating) || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Avaliação inválida. Deve ser entre 1 e 5 estrelas.' });
        }
        
        const q = query(collection(db, 'sites'));
        const snap = await getDocs(q);
        let targetDocId = null;
        let siteData = null;
        snap.forEach(d => {
            if (d.id === siteId || String(d.data().id) === String(siteId)) {
                targetDocId = d.id;
                siteData = d.data();
            }
        });
        if (!targetDocId) return res.status(404).json({ error: 'Site não encontrado.' });
        
        const currentSum = parseInt(siteData.ratingSum || 0);
        const currentCount = parseInt(siteData.ratingCount || 0);
        
        const newSum = currentSum + rating;
        const newCount = currentCount + 1;
        const averageRating = parseFloat((newSum / newCount).toFixed(1));
        
        await updateDoc(doc(db, 'sites', targetDocId), {
            ratingSum: newSum,
            ratingCount: newCount,
            averageRating: averageRating
        });
        
        console.log(`[Rating] Site ${siteId} rated with ${rating}. New average: ${averageRating} (${newCount} ratings)`);
        res.json({ ok: true, averageRating, ratingCount: newCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Edita metadados de um site (painel de professores)
app.patch('/api/sites/:siteId', rateLimiter(10, 60 * 1000), async (req, res) => {
    try {
        const siteId = req.params.siteId;
        const allowed = ['title', 'author', 'category', 'studentClass', 'teacher', 'school', 'city'];
        const patch = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) {
                patch[key] = sanitizeInput(req.body[key], key === 'school' || key === 'studentClass' ? 100 : 50);
            }
        }
        if (Object.keys(patch).length === 0)
            return res.status(400).json({ error: 'Nenhum campo válido para atualizar.' });

        const q = query(collection(db, 'sites'));
        const snap = await getDocs(q);
        let targetDocId = null;
        snap.forEach(d => {
            if (d.id === siteId || String(d.data().id) === String(siteId)) targetDocId = d.id;
        });
        if (!targetDocId) return res.status(404).json({ error: 'Site não encontrado.' });

        await updateDoc(doc(db, 'sites', targetDocId), patch);
        console.log(`[PATCH] Site ${siteId} updated:`, patch);
        res.json({ message: 'Site atualizado com sucesso.' });
    } catch (err) {
        console.error('[PATCH site]', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/sites/:siteId', rateLimiter(10, 60 * 1000), async (req, res) => {
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

// Incrementa contador de partidas de jogos
app.post('/api/games/:gameId/play', rateLimiter(30, 60 * 1000), async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const q = query(collection(db, 'games'));
        const snap = await getDocs(q);
        let targetDocId = null;
        snap.forEach(d => {
            if (d.id === gameId || String(d.data().id) === String(gameId)) targetDocId = d.id;
        });
        if (!targetDocId) return res.status(404).json({ error: 'Jogo não encontrado.' });
        await updateDoc(doc(db, 'games', targetDocId), { plays: increment(1) });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rate a game (1-5 stars)
app.post('/api/games/:gameId/rate', rateLimiter(20, 60 * 1000), async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const rating = parseInt(req.body.rating);
        if (isNaN(rating) || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Avaliação inválida. Deve ser entre 1 e 5 estrelas.' });
        }
        
        const q = query(collection(db, 'games'));
        const snap = await getDocs(q);
        let targetDocId = null;
        let gameData = null;
        snap.forEach(d => {
            if (d.id === gameId || String(d.data().id) === String(gameId)) {
                targetDocId = d.id;
                gameData = d.data();
            }
        });
        if (!targetDocId) return res.status(404).json({ error: 'Jogo não encontrado.' });
        
        const currentSum = parseInt(gameData.ratingSum || 0);
        const currentCount = parseInt(gameData.ratingCount || 0);
        
        const newSum = currentSum + rating;
        const newCount = currentCount + 1;
        const averageRating = parseFloat((newSum / newCount).toFixed(1));
        
        await updateDoc(doc(db, 'games', targetDocId), {
            ratingSum: newSum,
            ratingCount: newCount,
            averageRating: averageRating
        });
        
        console.log(`[Rating] Game ${gameId} rated with ${rating}. New average: ${averageRating} (${newCount} ratings)`);
        res.json({ ok: true, averageRating, ratingCount: newCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Edita metadados de um jogo (painel de professores)
app.patch('/api/games/:gameId', rateLimiter(10, 60 * 1000), async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const allowed = ['title', 'author', 'category', 'studentClass', 'teacher', 'school', 'city'];
        const patch = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) {
                patch[key] = sanitizeInput(req.body[key], key === 'school' || key === 'studentClass' ? 100 : 50);
            }
        }
        if (Object.keys(patch).length === 0)
            return res.status(400).json({ error: 'Nenhum campo válido para atualizar.' });

        const q = query(collection(db, 'games'));
        const snap = await getDocs(q);
        let targetDocId = null;
        snap.forEach(d => {
            if (d.id === gameId || String(d.data().id) === String(gameId)) targetDocId = d.id;
        });
        if (!targetDocId) return res.status(404).json({ error: 'Jogo não encontrado.' });

        await updateDoc(doc(db, 'games', targetDocId), patch);
        console.log(`[PATCH] Game ${gameId} updated:`, patch);
        res.json({ message: 'Jogo atualizado com sucesso.' });
    } catch (err) {
        console.error('[PATCH game]', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/games/:gameId', rateLimiter(10, 60 * 1000), async (req, res) => {
    try {
        const gameId = req.params.gameId;
        console.log(`[Delete] Attempting to delete game: ${gameId}`);
        
        // Find document in Firestore
        const q = query(collection(db, "games"));
        const snapshot = await getDocs(q);
        let targetDocId = null;
        let gameDataId = null;
        
        snapshot.forEach((docSnap) => {
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