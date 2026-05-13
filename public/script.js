const form = document.getElementById('gameForm');
const gamesContainer = document.getElementById('gamesContainer');
const emptyState = document.getElementById('emptyState');

document.addEventListener('DOMContentLoaded', loadGames);

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitButton = form.querySelector('button[type="submit"]');
    const status = document.getElementById('uploadStatus');
    status.innerText = "Enviando para o servidor...";
    status.className = "mt-2 text-center small text-warning";

    const gameTitle = document.getElementById('gameTitle').value.trim();
    const authorName = document.getElementById('authorName').value.trim();
    const gameCategory = document.getElementById('gameCategory').value;
    const gameFile = document.getElementById('gameFile').files[0];

    if (!gameTitle || !authorName || !gameCategory || !gameFile) {
        status.innerText = "Preencha todos os campos e selecione um arquivo.";
        status.className = "mt-2 text-center small text-danger";
        return;
    }

    submitButton.disabled = true;

    try {
        const formData = new FormData();
        formData.append('gameTitle', gameTitle);
        formData.append('authorName', authorName);
        formData.append('gameCategory', gameCategory);
        formData.append('gameFile', gameFile);

        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erro no envio');
        }

        status.innerText = "Jogo enviado com sucesso!";
        status.className = "mt-2 text-center small text-success";

        // Reset form
        form.reset();
        document.getElementById('gameFile').value = '';

        // Close modal after 2 seconds
        setTimeout(() => {
            const modal = bootstrap.Modal.getInstance(document.getElementById('uploadModal'));
            if (modal) modal.hide();
        }, 2000);

        // Reload games list
        await loadGames();

    } catch (err) {
        status.innerText = "Erro no envio: " + err.message;
        status.className = "mt-2 text-center small text-danger";
        console.error(err);
    } finally {
        submitButton.disabled = false;
    }
});

async function loadGames() {
    try {
        const response = await fetch('/api/games');
        if (!response.ok) throw new Error('Erro ao carregar jogos');
        
        const games = await response.json();
        gamesContainer.innerHTML = '';

        if (games.length === 0) {
            emptyState.classList.remove('d-none');
        } else {
            emptyState.classList.add('d-none');
            games.forEach((game) => {
                appendGame(game);
            });
        }
    } catch (error) {
        console.error("Erro ao carregar jogos:", error);
    }
}

function appendGame(game) {
    if (document.getElementById(`game-${game.id}`)) return;

    const card = `
    <div class="col" id="game-${game.id}">
        <div class="game-card-container position-relative">
            <div class="game-card" data-game-id="${game.id}" data-game-url="${game.url}" data-game-title="${game.title}" style="cursor: pointer;">
                <div class="game-img-wrapper">
                    <img src="https://source.unsplash.com/600x400/?${game.category},game" class="game-img" alt="${game.title}" onerror="this.src='https://via.placeholder.com/600x400?text=${encodeURIComponent(game.title)}'">
                    <div class="game-card-overlay">
                        <button class="btn btn-play-hover">
                            <i class="bi bi-controller me-2"></i> Jogar
                        </button>
                    </div>
                </div>
                <div class="card-body-modern">
                    <span class="category-tag">${game.category}</span>
                    <h3 class="h5 fw-bold mb-0">${game.title}</h3>
                    <div class="author-info">
                        <i class="bi bi-person-circle"></i>
                        <span>${game.author}</span>
                    </div>
                </div>
                <div class="card-footer-modern">
                    <button class="btn btn-sm btn-danger w-100 delete-btn" data-game-id="${game.id}">
                        <i class="bi bi-trash"></i> Deletar
                    </button>
                </div>
            </div>
        </div>
    </div>
    `;

    gamesContainer.innerHTML += card;
}

gamesContainer.addEventListener('click', async (e) => {
    const playBtn = e.target.closest('[class*="btn-play"]');
    const deleteBtn = e.target.closest('.delete-btn');

    if (playBtn) {
        const card = playBtn.closest('[data-game-id]');
        const url = card.dataset.gameUrl;
        const title = card.dataset.gameTitle;
        playGame(url, title);
    } else if (deleteBtn) {
        const gameId = deleteBtn.dataset.gameId;
        await deleteGame(gameId);
    }
});

function playGame(url, title) {
    try {
        const gameFrame = document.getElementById('gameFrame');
        const modalTitle = document.getElementById('playModalTitle');
        if (modalTitle) modalTitle.innerText = title;

        gameFrame.src = url;

        const modal = new bootstrap.Modal(document.getElementById('playModal'));
        modal.show();
    } catch (error) {
        console.error('Erro ao abrir jogo:', error);
        alert('Erro ao carregar o jogo: ' + error.message);
    }
}

async function deleteGame(gameId) {
    if (!confirm('Tem certeza que deseja deletar este jogo?')) return;

    try {
        const response = await fetch('/api/games/' + gameId, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erro ao deletar');
        }
        
        await loadGames();
    } catch (err) {
        alert('Erro ao deletar: ' + err.message);
        console.error(err);
    }
}

window.playGame = playGame;
window.deleteGame = deleteGame;

document.getElementById('playModal').addEventListener('hidden.bs.modal', () => {
    document.getElementById('gameFrame').src = '';
});
