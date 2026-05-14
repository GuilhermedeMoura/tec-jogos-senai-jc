const form = document.getElementById('gameForm');
const gamesContainer = document.getElementById('gamesContainer');
const emptyState = document.getElementById('emptyState');
const noResultsState = document.getElementById('noResultsState');

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
    const city = document.getElementById('citySelect').value;
    const school = document.getElementById('schoolSelect').value;
    const studentClass = document.getElementById('classSelect').value;
    const gameFile = document.getElementById('gameFile').files[0];

    if (!gameTitle || !authorName || !gameCategory || !city || !school || !studentClass || !gameFile) {
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
        formData.append('city', city);
        formData.append('school', school);
        formData.append('studentClass', studentClass);
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
        schoolSelect.innerHTML = '<option value="">Selecione a cidade primeiro</option>';
        classSelect.innerHTML = '<option value="">Selecione a escola primeiro</option>';

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
            noResultsState.classList.add('d-none');
        } else {
            emptyState.classList.add('d-none');
            games.forEach((game) => {
                appendGame(game);
            });
            // Aplica filtros após carregar (caso já tenha algo escrito)
            applyFilters();
        }
    } catch (error) {
        console.error("Erro ao carregar jogos:", error);
    }
}

function appendGame(game) {
    if (document.getElementById(`game-${game.id}`)) return;

    // Adicionamos atributos data-* para filtragem fácil
    const card = `
    <div class="col" id="game-${game.id}">
        <div class="game-card-container position-relative">
            <div class="game-card" 
                 data-game-id="${game.id}" 
                 data-game-url="${game.url}" 
                 data-game-title="${game.title}" 
                 data-author="${game.author}"
                 data-city="${game.city}"
                 data-school="${game.school}"
                 data-year="${game.studentClass}"
                 style="cursor: pointer;">
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
                    <div class="author-info flex-column align-items-start gap-1">
                        <div>
                            <i class="bi bi-person-circle"></i>
                            <span>${game.author} ${game.studentClass ? `- ${game.studentClass}` : ''}</span>
                        </div>
                        ${game.school ? `<div class="small"><i class="bi bi-building"></i> ${game.school}</div>` : ''}
                        ${game.city ? `<div class="small"><i class="bi bi-geo-alt"></i> ${game.city}</div>` : ''}
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

window.playGame = playGame;

async function deleteGame(gameId) {
    if (!confirm('Tem certeza que deseja deletar este jogo?')) return;

    try {
        const deleteBtn = document.querySelector(`.delete-btn[data-game-id="${gameId}"]`);
        if (deleteBtn) {
            deleteBtn.disabled = true;
            deleteBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Deletando...';
        }

        const response = await fetch('/api/games/' + gameId, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erro ao deletar');
        }

        // Remover o elemento visualmente sem recarregar a página toda
        const gameCard = document.getElementById(`game-${gameId}`);
        if (gameCard) {
            gameCard.remove();
            applyFilters(); // Reaplicar filtros para lidar com a mensagem de estado vazio
        }
        
    } catch (err) {
        alert('Erro ao deletar: ' + err.message);
        console.error(err);
        
        // Restaurar botão em caso de erro
        const deleteBtn = document.querySelector(`.delete-btn[data-game-id="${gameId}"]`);
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<i class="bi bi-trash"></i> Deletar';
        }
    }
}
window.deleteGame = deleteGame;

document.getElementById('playModal').addEventListener('hidden.bs.modal', () => {
    document.getElementById('gameFrame').src = '';
});

// --- SISTEMA DE FILTROS E PESQUISA ---

const schoolsData = {
    'Goiania': ['Colégio Estadual Nazir Safatle'],
    'Trindade': ['CEPI Abrão Manoel da Costa', 'Colégio Estadual José Ludovico de Almeida']
};

const searchInput = document.getElementById('searchInput');
const filterCity = document.getElementById('filterCity');
const filterSchool = document.getElementById('filterSchool');
const filterYear = document.getElementById('filterYear');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');

// Atualiza lista de escolas no filtro de busca quando a cidade muda
filterCity.addEventListener('change', () => {
    const city = filterCity.value;
    filterSchool.innerHTML = '<option value="">Todas</option>';

    if (city && schoolsData[city]) {
        schoolsData[city].forEach(school => {
            const opt = document.createElement('option');
            opt.value = school;
            opt.textContent = school;
            filterSchool.appendChild(opt);
        });
    }
    applyFilters();
});

// Event listeners para disparar a filtragem
searchInput.addEventListener('input', applyFilters);
filterSchool.addEventListener('change', applyFilters);
filterYear.addEventListener('change', applyFilters);

// Botão limpar filtros
clearFiltersBtn.addEventListener('click', () => {
    searchInput.value = '';
    filterCity.value = '';
    filterSchool.innerHTML = '<option value="">Todas</option>';
    filterYear.value = '';
    applyFilters();
});

function applyFilters() {
    const searchTerm = searchInput.value.toLowerCase();
    const cityValue = filterCity.value;
    const schoolValue = filterSchool.value;
    const yearValue = filterYear.value;

    const cards = document.querySelectorAll('#gamesContainer .col');
    let visibleCount = 0;

    cards.forEach(card => {
        const gameCard = card.querySelector('.game-card');

        // Pegando valores dos data attributes
        const author = (gameCard.dataset.author || '').toLowerCase();
        const title = (gameCard.dataset.gameTitle || '').toLowerCase();
        const city = gameCard.dataset.city || '';
        const school = gameCard.dataset.school || '';
        const year = gameCard.dataset.year || '';

        // Lógica de verificação
        let matchSearch = true;
        let matchCity = true;
        let matchSchool = true;
        let matchYear = true;

        // Filtro de pesquisa (Aluno ou Título)
        if (searchTerm) {
            matchSearch = author.includes(searchTerm) || title.includes(searchTerm);
        }

        // Filtros exatos
        if (cityValue && city !== cityValue) matchCity = false;
        if (schoolValue && school !== schoolValue) matchSchool = false;
        if (yearValue && year !== yearValue) matchYear = false;

        // Exibir ou ocultar
        if (matchSearch && matchCity && matchSchool && matchYear) {
            card.style.display = '';
            visibleCount++;
        } else {
            card.style.display = 'none';
        }
    });

    // Controle de estados vazios
    if (visibleCount === 0) {
        const hasGames = document.querySelectorAll('#gamesContainer .col').length > 0;
        if (hasGames) {
            emptyState.classList.add('d-none');
            noResultsState.classList.remove('d-none');
        } else {
            emptyState.classList.remove('d-none');
            noResultsState.classList.add('d-none');
        }
    } else {
        emptyState.classList.add('d-none');
        noResultsState.classList.add('d-none');
    }
}