# 🏗️ Arquitetura da Plataforma Tec Jogos Senai

## Visão Geral

```
┌─────────────────────────────────────────────────────────────┐
│                    FIREBASE                                  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │  Firebase        │  │  Firebase        │                │
│  │  Hosting         │  │  Firestore       │                │
│  │  (Web App)       │  │  (Metadados)     │                │
│  └────────┬─────────┘  └────────┬─────────┘                │
│           │                     │                           │
│           │                ┌────▼─────┐                    │
│           │                │ games     │                    │
│           │                │ collection│                    │
│           │                └───────────┘                    │
│           │                                                  │
│  ┌────────┴─────────────────┐                              │
│  │  Firebase Storage        │                              │
│  │  (ZIP & HTML files)      │                              │
│  └──────────────────────────┘                              │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │
                    ┌─────────┴─────────┐
                    │   Navegador       │
                    │   https://...     │
                    └───────────────────┘
```

## Componentes

### 1. **Firebase Hosting** 🌐
- Hospeda o frontend (HTML, CSS, JavaScript)
- URL: https://tec-jogos-senai-jc.web.app
- Servido globalmente com CDN rápido
- Arquivos: `/public/*`

### 2. **Firebase Firestore** 📊
- Banco de dados NoSQL em tempo real
- Armazena metadados dos jogos:
  - Título, Autor, Categoria
  - Data de upload
  - Referência para arquivo no Storage
  - URL de download

### 3. **Firebase Storage** 💾
- Armazenamento de arquivos em nuvem
- Guarda os ZIPs e HTMLs dos jogos
- Acesso direto via URL de download
- Path: `/games/*`

### 4. **Frontend (script.js)** ⚙️
- Importa APIs do Firebase
- Faz upload para Storage
- Salva metadados em Firestore
- Escuta mudanças em tempo real (onSnapshot)
- Renderiza galeria dinamicamente

## Fluxo de Funcionamento

### Upload de Jogo
```
1. Usuário preenche formulário
   ↓
2. Arquivo enviado para Firebase Storage
   ↓
3. Metadados salvos em Firestore
   ↓
4. Listeners atualizam galeria em tempo real
   ↓
5. Jogo aparece para todos os usuários
```

### Jogar um Jogo
```
1. Usuário clica no jogo
   ↓
2. App busca URL do Storage
   ↓
3. Abre em iframe (se HTML) ou oferece download (se ZIP)
```

### Deletar um Jogo
```
1. Usuário clica no botão Deletar
   ↓
2. Documento removido do Firestore
   ↓
3. Arquivo removido do Storage
   ↓
4. Galeria atualizada em tempo real
```

## Regras de Segurança

### Firestore (firestore.rules)
```
- Read: ✅ Público (todos podem ver)
- Create: ✅ Público (qualquer um pode fazer upload)
- Update/Delete: ✅ Público (qualquer um pode deletar)
```

### Storage (storage.rules)
```
- Read: ✅ Público (qualquer um pode fazer download)
- Write: ✅ Público (qualquer um pode fazer upload)
- Delete: ✅ Público (qualquer um pode deletar)
```

## Ambiente Local (Opcional)

O servidor Node.js em `server.js` é **opcional** e foi usado anteriormente para:
- Processar uploads (descompactar ZIPs)
- Servir API

Com Firebase, isso não é mais necessário, pois:
- Firebase Storage gerencia os arquivos
- Firestore é o banco de dados
- Hosting fornece o frontend

Se quiser usar localmente:
```bash
npm install
npm start
# Acesse: http://localhost:3000
```

## Variáveis de Ambiente

Nenhuma variável de ambiente é necessária! Todas as credenciais do Firebase estão no `script.js` (seguro pois são apenas chaves públicas).

## Segurança em Produção

### Recomendações:
1. ✅ **Autenticação**: Adicionar Firebase Auth para identificar usuários
2. ✅ **Validação**: Validar arquivo antes de upload (tamanho, tipo)
3. ✅ **Rate Limiting**: Limitar uploads por usuário
4. ✅ **Scan de Malware**: Integrar antivírus antes de armazenar

Exemplo de regra segura:
```
allow create: if request.auth != null && 
             request.resource.size < 100 * 1024 * 1024;
```

## Performance

- ⚡ CDN global (Firebase Hosting)
- ⚡ Índices automáticos (Firestore)
- ⚡ Real-time listeners (onSnapshot)
- ⚡ Compressão de arquivos (opcional)

## Custo

Firebase oferece plano **Spark (Gratuito)** com limites:
- Firestore: 1 GB de armazenamento, 50k leituras/dia
- Hosting: 10 GB/mês de dados enviados
- Storage: 5 GB de armazenamento

Para um plano **Blaze (Pay-as-you-go)**, pague apenas pelo que usar.

---

**Status**: ✅ Pronto para uso  
**Última atualização**: Maio 2026
