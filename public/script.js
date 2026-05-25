const form = document.getElementById('gameForm');
const gamesContainer = document.getElementById('gamesContainer');
const emptyState = document.getElementById('emptyState');
const noResultsState = document.getElementById('noResultsState');
const paginationContainer = document.getElementById('paginationContainer');

// Estado da Paginação e Filtros
let allGames = [];
let filteredGames = [];
let currentPage = 1;
const itemsPerPage = 8;

// Dados compartilhados entre formulário de upload e barra de filtros
const schoolsData = {
    'Goiania': [
        'Colégio Estadual Nazir Safatle',
        'Colégio Estadual Verany Machado De Oliveira',
        'Colégio Estadual João Bênio',
        'Colégio Estadual Edmundo Rocha',
        'Colégio Estadual Albert Sabin'
    ],
    'Trindade': [
        'CEPI Abrão Manoel da Costa',
        'Colégio Estadual Padre Pelágio',
        'Colégio Estadual Alfa Ômega'
    ]
};

document.addEventListener('DOMContentLoaded', loadGames);

// --- LÓGICA DO MODAL DE UPLOAD ---
const citySelect = document.getElementById('citySelect');
const schoolSelect = document.getElementById('schoolSelect');
const classSelect = document.getElementById('classSelect');

if (citySelect && schoolSelect && classSelect) {
    citySelect.addEventListener('change', () => {
        schoolSelect.innerHTML = '<option value="">Selecione a cidade primeiro</option>';
        classSelect.innerHTML = '<option value="">Selecione a escola primeiro</option>';

        const city = citySelect.value;
        if (city && schoolsData[city]) {
            schoolSelect.innerHTML = '<option value="">Selecione...</option>';
            schoolsData[city].forEach(school => {
                const opt = document.createElement('option');
                opt.value = school;
                opt.textContent = school;
                schoolSelect.appendChild(opt);
            });
        }
    });

    schoolSelect.addEventListener('change', () => {
        classSelect.innerHTML = '<option value="">Selecione a escola primeiro</option>';
        if (schoolSelect.value !== '') {
            classSelect.innerHTML = `
            <option value="">Selecione...</option>
            <option value="1° Ano Técnico em Programação de Jogos Digitais">1° Ano Técnico em Programação de Jogos Digitais</option>
            <option value="1° Ano Técnico em Desenvolvimento de Sistemas">1° Ano Técnico em Desenvolvimento de Sistemas</option>
            <option value="2° Ano Técnico em Programação de Jogos Digitais">2° Ano Técnico em Programação de Jogos Digitais</option>
            <option value="2° Ano Técnico em Desenvolvimento de Sistemas">2° Ano Técnico em Desenvolvimento de Sistemas</option>
            `;
        }
    });
}

// --- PREVIEW DA IMAGEM DE CAPA ---
const coverImageInput = document.getElementById('coverImage');
const coverPreviewWrapper = document.getElementById('coverPreviewWrapper');
const coverPreview = document.getElementById('coverPreview');
const removeCoverBtn = document.getElementById('removeCoverBtn');

if (coverImageInput) {
    coverImageInput.addEventListener('change', () => {
        const file = coverImageInput.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                coverPreview.src = ev.target.result;
                coverPreviewWrapper.classList.remove('d-none');
            };
            reader.readAsDataURL(file);
        }
    });

    removeCoverBtn.addEventListener('click', () => {
        coverImageInput.value = '';
        coverPreview.src = '';
        coverPreviewWrapper.classList.add('d-none');
    });
}

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
    const teacher = document.getElementById('teacherSelect').value;
    const gameFile = document.getElementById('gameFile').files[0];
    const coverFile = document.getElementById('coverImage').files[0] || null;

    if (!gameTitle || !authorName || !gameCategory || !city || !school || !studentClass || !teacher || !gameFile) {
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
        formData.append('teacher', teacher);
        formData.append('gameFile', gameFile);
        if (coverFile) formData.append('coverImage', coverFile);

        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            let errorMsg = `Erro ${response.status}: ${response.statusText || 'Falha no servidor'}`;
            try {
                const ct = response.headers.get('content-type') || '';
                if (ct.includes('application/json')) {
                    const errorData = await response.json();
                    errorMsg = errorData.error || errorMsg;
                }
            } catch (_) { /* ignora falha ao parsear o corpo do erro */ }
            throw new Error(errorMsg);
        }

        status.innerText = "Jogo enviado com sucesso!";
        status.className = "mt-2 text-center small text-success";

        // Reset form
        form.reset();
        document.getElementById('gameFile').value = '';
        document.getElementById('coverImage').value = '';
        coverPreview.src = '';
        coverPreviewWrapper.classList.add('d-none');
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

        allGames = await response.json();
        filteredGames = [...allGames];
        currentPage = 1;

        if (allGames.length === 0) {
            emptyState.classList.remove('d-none');
            noResultsState.classList.add('d-none');
            paginationContainer.innerHTML = '';
        } else {
            emptyState.classList.add('d-none');
            displayGames(currentPage);
            renderPagination();
            // Aplica filtros após carregar (caso já tenha algo escrito na busca/filtros)
            applyFilters();
        }
    } catch (error) {
        console.error("Erro ao carregar jogos:", error);
    }
}

function getGameCardHtml(game) {
    const uniqueId = game.docId || game.id;
    return `
    <div class="col" id="game-${uniqueId}">
        <div class="game-card-container position-relative">
            <div class="game-card" 
                 data-game-id="${uniqueId}" 
                 data-game-url="${game.url}" 
                 data-game-title="${game.title}" 
                 data-author="${game.author}"
                 data-city="${game.city}"
                 data-school="${game.school}"
                 data-year="${game.studentClass}"
                 data-game-type="${game.gameType || 'html'}"
                 style="cursor: pointer;">
                <div class="game-img-wrapper">
                    <img src="${game.coverUrl || `https://source.unsplash.com/600x400/?${game.category},game`}" class="game-img" alt="${game.title}" onerror="this.src='https://via.placeholder.com/600x400?text=${encodeURIComponent(game.title)}'">
                    <div class="game-card-overlay">
                        <button class="btn btn-play-hover">
                            ${game.gameType === 'python'
            ? '<i class="bi bi-box-arrow-up-right me-2"></i> Abrir Jogo'
            : '<i class="bi bi-controller me-2"></i> Jogar'}
                        </button>
                    </div>
                    ${game.gameType === 'python' ? `<span style="position:absolute;top:10px;left:10px;background:rgba(0,0,0,.65);color:#f8c037;font-size:.7rem;font-weight:700;padding:3px 9px;border-radius:50px;backdrop-filter:blur(4px);">🐍 Python</span>` : ''}
                </div>
                <div class="card-body-modern">
                    <span class="category-tag">${game.category}</span>
                    <h3 class="h5 fw-bold mb-0">${game.title}</h3>
                    <div class="author-info flex-column align-items-start gap-1">
                        <div>
                            <i class="bi bi-person-circle"></i>
                            <span>${game.author} ${game.studentClass ? `- ${game.studentClass}` : ''}</span>
                        </div>
                        ${game.teacher ? `<div class="small"><i class="bi bi-mortarboard"></i> Prof. ${game.teacher}</div>` : ''}
                        ${game.school ? `<div class="small"><i class="bi bi-building"></i> ${game.school}</div>` : ''}
                        ${game.city ? `<div class="small"><i class="bi bi-geo-alt"></i> ${game.city}</div>` : ''}
                    </div>
                    <div class="d-flex justify-content-end mt-2">
                        <span class="plays-badge" id="plays-${uniqueId}" data-count="${game.plays || 0}" title="Partidas jogadas">
                            <i class="bi bi-controller"></i>
                            ${(game.plays || 0) === 1 ? '1 jogada' : `${game.plays || 0} jogadas`}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `;
}

function displayGames(page) {
    gamesContainer.innerHTML = '';
    
    if (filteredGames.length === 0) {
        if (allGames.length > 0) {
            emptyState.classList.add('d-none');
            noResultsState.classList.remove('d-none');
        } else {
            emptyState.classList.remove('d-none');
            noResultsState.classList.add('d-none');
        }
        paginationContainer.innerHTML = '';
        return;
    }

    emptyState.classList.add('d-none');
    noResultsState.classList.add('d-none');

    const start = (page - 1) * itemsPerPage;
    const end = Math.min(start + itemsPerPage, filteredGames.length);
    
    const paginatedItems = filteredGames.slice(start, end);
    const html = paginatedItems.map(getGameCardHtml).join('');
    gamesContainer.innerHTML = html;
}

function renderPagination() {
    paginationContainer.innerHTML = '';
    
    const totalPages = Math.ceil(filteredGames.length / itemsPerPage);
    if (totalPages <= 1) return;

    // Botão Anterior
    const prevBtn = document.createElement('button');
    prevBtn.className = 'pagination-btn';
    prevBtn.innerHTML = '<i class="bi bi-chevron-left"></i>';
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            displayGames(currentPage);
            renderPagination();
            document.getElementById('gallery').scrollIntoView({ behavior: 'smooth' });
        }
    });
    paginationContainer.appendChild(prevBtn);

    // Numeração de páginas inteligente
    const range = 1;
    let showEllipsisBefore = false;
    let showEllipsisAfter = false;

    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - range && i <= currentPage + range)) {
            const pageBtn = document.createElement('button');
            pageBtn.className = `pagination-btn ${i === currentPage ? 'active' : ''}`;
            pageBtn.textContent = i;
            pageBtn.addEventListener('click', () => {
                currentPage = i;
                displayGames(currentPage);
                renderPagination();
                document.getElementById('gallery').scrollIntoView({ behavior: 'smooth' });
            });
            paginationContainer.appendChild(pageBtn);
        } else if (i < currentPage - range && !showEllipsisBefore) {
            showEllipsisBefore = true;
            const ellipsis = document.createElement('span');
            ellipsis.className = 'pagination-ellipsis';
            ellipsis.textContent = '...';
            paginationContainer.appendChild(ellipsis);
        } else if (i > currentPage + range && !showEllipsisAfter) {
            showEllipsisAfter = true;
            const ellipsis = document.createElement('span');
            ellipsis.className = 'pagination-ellipsis';
            ellipsis.textContent = '...';
            paginationContainer.appendChild(ellipsis);
        }
    }

    // Botão Próximo
    const nextBtn = document.createElement('button');
    nextBtn.className = 'pagination-btn';
    nextBtn.innerHTML = '<i class="bi bi-chevron-right"></i>';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            displayGames(currentPage);
            renderPagination();
            document.getElementById('gallery').scrollIntoView({ behavior: 'smooth' });
        }
    });
    paginationContainer.appendChild(nextBtn);
}

gamesContainer.addEventListener('click', async (e) => {
    const playBtn = e.target.closest('[class*="btn-play"]');

    if (playBtn) {
        const card = playBtn.closest('[data-game-id]');
        const url = card.dataset.gameUrl;
        const title = card.dataset.gameTitle;
        const gameType = card.dataset.gameType;
        const gameId = card.dataset.gameId;

        // Incrementa contador (fire-and-forget, não bloqueia o jogo)
        fetch(`/api/games/${gameId}/play`, { method: 'POST' })
            .then(() => {
                const badge = document.getElementById(`plays-${gameId}`);
                if (badge) {
                    const cur = parseInt(badge.dataset.count || '0') + 1;
                    badge.dataset.count = cur;
                    badge.innerHTML = `<i class="bi bi-controller"></i> ${cur} ${cur === 1 ? 'jogada' : 'jogadas'}`;
                }
            })
            .catch(() => { });

        // Jogos Python abrem em nova aba
        if (gameType === 'python') {
            window.open(url, '_blank', 'noopener');
            return;
        }

        playGame(url, title);
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

document.getElementById('playModal').addEventListener('hidden.bs.modal', () => {
    document.getElementById('gameFrame').src = '';
});

// --- SISTEMA DE FILTROS E PESQUISA ---

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

    filteredGames = allGames.filter(game => {
        const author = (game.author || '').toLowerCase();
        const title = (game.title || '').toLowerCase();
        const city = game.city || '';
        const school = game.school || '';
        const year = game.studentClass || '';

        // Filtro de pesquisa (Aluno ou Título)
        let matchSearch = !searchTerm || author.includes(searchTerm) || title.includes(searchTerm);
        
        // Filtros exatos
        let matchCity = !cityValue || city === cityValue;
        let matchSchool = !schoolValue || school === schoolValue;
        let matchYear = !yearValue || year === yearValue;

        return matchSearch && matchCity && matchSchool && matchYear;
    });

    currentPage = 1;
    displayGames(currentPage);
    renderPagination();
}