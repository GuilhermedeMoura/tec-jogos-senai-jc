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
        'Colégio Estadual Albert Sabin',
        'Colégio Estadual João José Coutinho'
    ],
    'Trindade': [
        'CEPI Abrão Manoel da Costa',
        'Colégio Estadual Padre Pelágio',
        'Colégio Estadual Alfa Ômega'
    ]
};

document.addEventListener('DOMContentLoaded', () => {
    loadGames();
    updateAuthNavbar();
    setupAuthForms();
    setupEditForm();
});

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

        const token = localStorage.getItem('student_token');
        const headers = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch('/upload', {
            method: 'POST',
            headers: headers,
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

        // Popula o carrossel dos top 5 mais jogados
        populateTopWeeklyCarousel(allGames);

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

function populateTopWeeklyCarousel(games) {
    const carouselInner = document.getElementById('carouselInner');
    const carouselIndicators = document.getElementById('carouselIndicators');
    
    if (!carouselInner || !carouselIndicators) return;
    
    carouselInner.innerHTML = '';
    carouselIndicators.innerHTML = '';
    
    const topGames = [...games]
        .sort((a, b) => (b.plays || 0) - (a.plays || 0))
        .slice(0, 5);
        
    if (topGames.length === 0) {
        carouselInner.innerHTML = `
            <div class="carousel-item active">
                <div class="carousel-loading-card">
                    <i class="bi bi-joystick display-4 text-white-50 mb-3"></i>
                    <p class="m-0 text-white-50">Nenhum jogo enviado ainda.</p>
                </div>
            </div>
        `;
        return;
    }
    
    topGames.forEach((game, index) => {
        const uniqueId = game.docId || game.id;
        const avgRating = game.averageRating || 0;
        const coverImg = game.coverUrl || `https://via.placeholder.com/600x400?text=${encodeURIComponent(game.title)}`;
        
        // Indicator
        const indicator = document.createElement('button');
        indicator.type = 'button';
        indicator.dataset.bsTarget = '#topWeeklyCarousel';
        indicator.dataset.bsSlideTo = index;
        if (index === 0) {
            indicator.className = 'active';
            indicator.ariaCurrent = 'true';
        }
        indicator.ariaLabel = `Slide ${index + 1}`;
        carouselIndicators.appendChild(indicator);
        
        // Slide item
        const item = document.createElement('div');
        item.className = `carousel-item ${index === 0 ? 'active' : ''}`;
        
        item.innerHTML = `
            <div class="premium-carousel-card" 
                 data-game-id="${uniqueId}" 
                 data-game-url="${game.url}" 
                 data-game-title="${game.title.replace(/"/g, '&quot;')}" 
                 data-game-type="${game.gameType || 'html'}"
                 style="background-image: linear-gradient(135deg, rgba(19, 20, 26, 0.95) 45%, rgba(19, 20, 26, 0.35) 100%), url('${coverImg}'); cursor: pointer;">
                <div class="top-rank-badge">
                    <i class="bi bi-trophy-fill me-1"></i> TOP #${index + 1}
                </div>
                <div class="carousel-project-info">
                    <h3 class="carousel-project-title text-gradient">${game.title}</h3>
                    <ul class="carousel-meta-list">
                        <li class="carousel-meta-item">
                            <i class="bi bi-person-circle"></i>
                            <div><strong>Desenvolvedor:</strong> ${game.author}</div>
                        </li>
                        <li class="carousel-meta-item">
                            <i class="bi bi-code-slash"></i>
                            <div><strong>Turma:</strong> ${game.studentClass || 'N/A'}</div>
                        </li>
                        <li class="carousel-meta-item">
                            <i class="bi bi-mortarboard-fill"></i>
                            <div><strong>Professor:</strong> ${game.teacher || 'N/A'}</div>
                        </li>
                        <li class="carousel-meta-item">
                            <i class="bi bi-building"></i>
                            <div><strong>Escola:</strong> ${game.school || 'N/A'}</div>
                        </li>
                    </ul>
                </div>
                <div class="carousel-action-row">
                    <button class="btn btn-modern-primary carousel-play-btn">
                        <i class="bi bi-controller"></i> Jogar Agora
                    </button>
                    <div class="carousel-stats-badge">
                        <i class="bi bi-star-fill"></i>
                        <span>${avgRating > 0 ? avgRating.toFixed(1) : 'S/A'}</span>
                        <span class="text-white-50 mx-1">|</span>
                        <span>${game.plays || 0} jogadas</span>
                    </div>
                </div>
            </div>
        `;
        carouselInner.appendChild(item);
    });

    // Reiniciar e forçar o auto-slide do Bootstrap Carousel a cada 4 segundos
    const carouselEl = document.getElementById('topWeeklyCarousel');
    if (carouselEl) {
        const carouselInstance = bootstrap.Carousel.getOrCreateInstance(carouselEl, {
            interval: 4000,
            ride: 'carousel'
        });
        carouselInstance.to(0);
        carouselInstance.cycle();
    }
}

function getGameCardHtml(game) {
    const uniqueId = game.docId || game.id;
    const avgRating = game.averageRating || 0;
    const ratingCount = game.ratingCount || 0;
    const isRated = localStorage.getItem('rated-game-' + uniqueId) !== null;
    
    const currentUser = JSON.parse(localStorage.getItem('student_user') || 'null');
    const isOwner = currentUser && game.ownerId === currentUser.id;
    const editBtnHtml = isOwner ? `
        <button class="btn btn-edit-game-card btn-edit-game" title="Editar jogo" data-game-id="${uniqueId}">
            <i class="bi bi-pencil-fill"></i>
        </button>
    ` : '';
    
    let starsHtml = '';
    for (let i = 1; i <= 5; i++) {
        const starClass = i <= Math.round(avgRating) ? 'bi-star-fill active-star' : 'bi-star';
        starsHtml += `<i class="bi ${starClass}" data-rating="${i}"></i>`;
    }

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
                    ${editBtnHtml}
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
                    
                    <!-- Sistema de Avaliação -->
                    <div class="card-rating-container">
                        <div class="star-rating ${isRated ? 'rated' : ''}" data-project-id="${uniqueId}" data-current-avg="${avgRating}">
                            ${starsHtml}
                        </div>
                        ${!isRated ? `<button class="btn btn-sm btn-submit-rating d-none" data-project-id="${uniqueId}">Enviar</button>` : ''}
                        <span class="rating-text">
                            <span class="rating-value">${avgRating > 0 ? avgRating.toFixed(1) : '-.-'}</span> 
                            (${ratingCount} ${ratingCount === 1 ? 'avaliação' : 'avaliações'})
                        </span>
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
    const editBtn = e.target.closest('.btn-edit-game');
    if (editBtn) {
        e.stopPropagation();
        const gameId = editBtn.dataset.gameId;
        openEditModal(gameId);
        return;
    }

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

const carouselInner = document.getElementById('carouselInner');
if (carouselInner) {
    carouselInner.addEventListener('click', (e) => {
        const card = e.target.closest('.premium-carousel-card');
        if (card) {
            const url = card.dataset.gameUrl;
            const title = card.dataset.gameTitle;
            const gameType = card.dataset.gameType;
            const gameId = card.dataset.gameId;

            // Incrementa contador (fire-and-forget)
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
}

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
        const teacher = (game.teacher || '').toLowerCase();
        const city = game.city || '';
        const school = game.school || '';
        const year = game.studentClass || '';

        // Filtro de pesquisa (Aluno, Título ou Professor)
        let matchSearch = !searchTerm || author.includes(searchTerm) || title.includes(searchTerm) || teacher.includes(searchTerm);
        
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

// --- DELEGAÇÃO DE EVENTOS PARA AVALIAÇÃO DE ESTRELAS ---

// Efeito de Hover ao passar o mouse nas estrelas
gamesContainer.addEventListener('mouseover', (e) => {
    const star = e.target.closest('.star-rating i');
    if (star) {
        const starContainer = star.closest('.star-rating');
        if (starContainer.classList.contains('rated')) return;

        const rating = parseInt(star.dataset.rating);
        const stars = starContainer.querySelectorAll('i');
        stars.forEach((s, idx) => {
            if (idx < rating) {
                s.className = 'bi bi-star-fill active-star';
            } else {
                s.className = 'bi bi-star';
            }
        });
    }
});

// Restaurar visual quando o mouse sai do contêiner de estrelas
gamesContainer.addEventListener('mouseout', (e) => {
    const starContainer = e.target.closest('.star-rating');
    if (starContainer && !starContainer.classList.contains('rated')) {
        const stars = starContainer.querySelectorAll('i');
        
        // Se já tiver uma nota pré-selecionada pelo clique, restaura nela. Caso contrário, restaura na média atual.
        const selectedRating = parseInt(starContainer.dataset.selectedRating || '0');
        const avg = parseFloat(starContainer.dataset.currentAvg || '0');
        const targetVal = selectedRating > 0 ? selectedRating : Math.round(avg);

        stars.forEach((s, idx) => {
            if (idx < targetVal) {
                s.className = 'bi bi-star-fill active-star';
            } else {
                s.className = 'bi bi-star';
            }
        });
    }
});

// Clique na estrela para SELECIONAR (mas não enviar ainda)
gamesContainer.addEventListener('click', (e) => {
    const star = e.target.closest('.star-rating i');
    if (star) {
        e.stopPropagation(); // Evita abrir o modal do jogo
        const starContainer = star.closest('.star-rating');
        if (starContainer.classList.contains('rated')) return;

        const rating = parseInt(star.dataset.rating);
        if (isNaN(rating) || rating < 1 || rating > 5) return;

        // Salva a nota pré-selecionada no dataset do contêiner
        starContainer.dataset.selectedRating = rating;

        // Atualiza a exibição visual das estrelas
        const stars = starContainer.querySelectorAll('i');
        stars.forEach((s, idx) => {
            if (idx < rating) {
                s.className = 'bi bi-star-fill active-star';
            } else {
                s.className = 'bi bi-star';
            }
        });

        // Torna visível o botão de "Enviar" deste card específico
        const ratingContainer = starContainer.closest('.card-rating-container');
        if (ratingContainer) {
            const submitBtn = ratingContainer.querySelector('.btn-submit-rating');
            if (submitBtn) submitBtn.classList.remove('d-none');
        }
    }
});

// Clique no botão "Enviar" para submeter avaliação ao servidor
gamesContainer.addEventListener('click', async (e) => {
    const submitBtn = e.target.closest('.btn-submit-rating');
    if (submitBtn) {
        e.stopPropagation(); // Evita abrir o modal
        const projectId = submitBtn.dataset.projectId;
        const ratingContainer = submitBtn.closest('.card-rating-container');
        if (!ratingContainer) return;

        const starContainer = ratingContainer.querySelector('.star-rating');
        if (!starContainer || starContainer.classList.contains('rated')) return;

        const selectedRating = parseInt(starContainer.dataset.selectedRating || '0');
        if (selectedRating < 1 || selectedRating > 5) {
            alert('Por favor, selecione uma nota de 1 a 5 estrelas primeiro.');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerText = 'Enviando...';

        try {
            const response = await fetch(`/api/games/${projectId}/rate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rating: selectedRating })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Falha ao processar avaliação');
            }

            const result = await response.json();
            
            // Persistir no localStorage local
            localStorage.setItem(`rated-game-${projectId}`, 'true');
            
            // Marcar como avaliado e travar estrelas
            starContainer.classList.add('rated');
            starContainer.dataset.currentAvg = result.averageRating;
            
            // Ocultar o botão Enviar
            submitBtn.classList.add('d-none');
            
            // Fixar a avaliação visualmente
            const stars = starContainer.querySelectorAll('i');
            stars.forEach((s, idx) => {
                s.style.cursor = 'default';
                if (idx < selectedRating) {
                    s.className = 'bi bi-star-fill active-star';
                } else {
                    s.className = 'bi bi-star';
                }
            });

            // Atualizar valores de texto do card
            const ratingText = ratingContainer.querySelector('.rating-text');
            if (ratingText) {
                const count = result.ratingCount;
                ratingText.innerHTML = `
                    <span class="rating-value">${result.averageRating.toFixed(1)}</span> 
                    (${count} ${count === 1 ? 'avaliação' : 'avaliações'})
                `;
            }

            console.log(`[Rating Success] Registered ${selectedRating} stars for game ${projectId}`);
            
            // Atualiza a lista interna para sincronizar o carrossel no topo em paralelo
            const gameObj = allGames.find(p => (p.docId || p.id) === projectId);
            if (gameObj) {
                gameObj.averageRating = result.averageRating;
                gameObj.ratingCount = result.ratingCount;
                populateTopWeeklyCarousel(allGames);
            }

        } catch (err) {
            console.error('Erro ao avaliar:', err.message);
            alert('Não foi possível registrar sua avaliação: ' + err.message);
            submitBtn.disabled = false;
            submitBtn.innerText = 'Enviar';
        }
    }
});

// --- CLIENT AUTHENTICATION AND LOGGED-IN ACTIONS LOGIC ---

function updateAuthNavbar() {
    const container = document.getElementById('authNavContainer');
    if (!container) return;
    
    const token = localStorage.getItem('student_token');
    const user = JSON.parse(localStorage.getItem('student_user') || 'null');
    
    if (token && user) {
        container.innerHTML = `
            <span class="text-white-50 small me-1"><i class="bi bi-person-circle"></i> Olá, ${user.name}</span>
            <button class="btn btn-outline-danger btn-sm rounded-pill px-3" id="navLogoutBtn">Sair</button>
        `;
        document.getElementById('navLogoutBtn').addEventListener('click', () => {
            localStorage.removeItem('student_token');
            localStorage.removeItem('student_user');
            updateAuthNavbar();
            loadGames();
        });
    } else {
        container.innerHTML = `
            <button class="btn btn-outline-light btn-sm rounded-pill px-3" data-bs-toggle="modal" data-bs-target="#authModal" id="navLoginBtn">
                <i class="bi bi-person-fill me-1"></i> Entrar
            </button>
        `;
    }
}

function setupAuthForms() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const forgotForm = document.getElementById('forgotForm');
    
    // Configura botões de transição para o painel de abas
    const loginTabBtn = document.getElementById('login-tab');
    const registerTabBtn = document.getElementById('register-tab');
    
    if (loginTabBtn) {
        loginTabBtn.addEventListener('click', () => {
            const forgotTab = document.getElementById('forgotTabContent');
            if (forgotTab) forgotTab.classList.remove('show', 'active');
        });
    }
    
    if (registerTabBtn) {
        registerTabBtn.addEventListener('click', () => {
            const forgotTab = document.getElementById('forgotTabContent');
            if (forgotTab) forgotTab.classList.remove('show', 'active');
        });
    }
    
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('authLoginUser').value.trim();
            const password = document.getElementById('authLoginPass').value;
            const status = document.getElementById('loginStatus');
            
            status.innerText = "Entrando...";
            status.className = "mt-2 text-center small text-warning";
            
            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Erro ao fazer login.');
                
                localStorage.setItem('student_token', data.token);
                localStorage.setItem('student_user', JSON.stringify(data.user));
                
                status.innerText = "Login realizado com sucesso!";
                status.className = "mt-2 text-center small text-success";
                
                loginForm.reset();
                
                setTimeout(() => {
                    const modal = bootstrap.Modal.getInstance(document.getElementById('authModal'));
                    if (modal) modal.hide();
                    status.innerText = "";
                    updateAuthNavbar();
                    loadGames();
                }, 1000);
                
            } catch (err) {
                status.innerText = err.message;
                status.className = "mt-2 text-center small text-danger";
            }
        });
    }
    
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('authRegName').value.trim();
            const email = document.getElementById('authRegEmail').value.trim().toLowerCase();
            const username = document.getElementById('authRegUser').value.trim();
            const password = document.getElementById('authRegPass').value;
            const status = document.getElementById('registerStatus');
            
            if (!email.endsWith('@aluno.educa.go.gov.br')) {
                status.innerText = "Utilize um e-mail escolar válido (@aluno.educa.go.gov.br).";
                status.className = "mt-2 text-center small text-danger";
                return;
            }

            status.innerText = "Criando conta...";
            status.className = "mt-2 text-center small text-warning";
            
            try {
                const response = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, username, password })
                });
                
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Erro ao registrar.');
                
                localStorage.setItem('student_token', data.token);
                localStorage.setItem('student_user', JSON.stringify(data.user));
                
                status.innerText = "Conta criada com sucesso!";
                status.className = "mt-2 text-center small text-success";
                
                registerForm.reset();
                
                setTimeout(() => {
                    const modal = bootstrap.Modal.getInstance(document.getElementById('authModal'));
                    if (modal) modal.hide();
                    status.innerText = "";
                    updateAuthNavbar();
                    loadGames();
                }, 1000);
                
            } catch (err) {
                status.innerText = err.message;
                status.className = "mt-2 text-center small text-danger";
            }
        });
    }

    if (forgotForm) {
        forgotForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('authForgotEmail').value.trim().toLowerCase();
            const status = document.getElementById('forgotStatus');
            
            if (!email.endsWith('@aluno.educa.go.gov.br')) {
                status.innerText = "Utilize um e-mail escolar válido (@aluno.educa.go.gov.br).";
                status.className = "mt-2 text-center small text-danger";
                return;
            }
            
            const submitBtn = forgotForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            status.innerText = "Processando...";
            status.className = "mt-2 text-center small text-warning";
            
            try {
                const response = await fetch('/api/auth/forgot-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Erro ao enviar solicitação.');
                
                status.innerText = data.message || "Link de redefinição enviado!";
                status.className = "mt-2 text-center small text-success";
                forgotForm.reset();
            } catch (err) {
                status.innerText = err.message;
                status.className = "mt-2 text-center small text-danger";
            } finally {
                submitBtn.disabled = false;
            }
        });
    }
}

function populateEditSchools(city, selectedSchool = '') {
    const schoolSelect = document.getElementById('editSchoolSelect');
    schoolSelect.innerHTML = '<option value="">Selecione a cidade primeiro</option>';
    
    if (city && schoolsData[city]) {
        schoolSelect.innerHTML = '<option value="">Selecione...</option>';
        schoolsData[city].forEach(school => {
            const opt = document.createElement('option');
            opt.value = school;
            opt.textContent = school;
            if (school === selectedSchool) opt.selected = true;
            schoolSelect.appendChild(opt);
        });
    }
}

function populateEditClasses(school, selectedClass = '') {
    const classSelect = document.getElementById('editClassSelect');
    classSelect.innerHTML = '<option value="">Selecione a escola primeiro</option>';
    
    if (school) {
        classSelect.innerHTML = `
        <option value="">Selecione...</option>
        <option value="1° Ano Técnico em Programação de Jogos Digitais">1° Ano Técnico em Programação de Jogos Digitais</option>
        <option value="1° Ano Técnico em Desenvolvimento de Sistemas">1° Ano Técnico em Desenvolvimento de Sistemas</option>
        <option value="2° Ano Técnico em Programação de Jogos Digitais">2° Ano Técnico em Programação de Jogos Digitais</option>
        <option value="2° Ano Técnico em Desenvolvimento de Sistemas">2° Ano Técnico em Desenvolvimento de Sistemas</option>
        `;
        if (selectedClass) classSelect.value = selectedClass;
    }
}

function openEditModal(gameId) {
    const game = allGames.find(g => (g.docId || g.id) === gameId);
    if (!game) return;
    
    document.getElementById('editGameId').value = gameId;
    document.getElementById('editGameTitle').value = game.title || '';
    document.getElementById('editGameCategory').value = game.category || 'Ação';
    
    const citySelect = document.getElementById('editCitySelect');
    const schoolSelect = document.getElementById('editSchoolSelect');
    const classSelect = document.getElementById('editClassSelect');
    const teacherSelect = document.getElementById('editTeacherSelect');
    
    citySelect.value = game.city || '';
    
    populateEditSchools(game.city, game.school);
    populateEditClasses(game.school, game.studentClass);
    
    teacherSelect.value = game.teacher || '';
    
    // Limpa campos de arquivo
    document.getElementById('editGameFile').value = '';
    document.getElementById('editCoverImage').value = '';
    
    const previewWrapper = document.getElementById('editCoverPreviewWrapper');
    const previewImg = document.getElementById('editCoverPreview');
    if (game.coverUrl) {
        previewImg.src = game.coverUrl;
        previewWrapper.classList.remove('d-none');
    } else {
        previewImg.src = '';
        previewWrapper.classList.add('d-none');
    }
    
    document.getElementById('editStatus').innerText = '';
    
    const editModal = new bootstrap.Modal(document.getElementById('editModal'));
    editModal.show();
}

function setupEditForm() {
    const citySelect = document.getElementById('editCitySelect');
    const schoolSelect = document.getElementById('editSchoolSelect');
    const classSelect = document.getElementById('editClassSelect');
    
    if (citySelect && schoolSelect && classSelect) {
        citySelect.addEventListener('change', () => {
            populateEditSchools(citySelect.value);
            classSelect.innerHTML = '<option value="">Selecione a escola primeiro</option>';
        });
        
        schoolSelect.addEventListener('change', () => {
            populateEditClasses(schoolSelect.value);
        });
    }
    
    const coverInput = document.getElementById('editCoverImage');
    const previewWrapper = document.getElementById('editCoverPreviewWrapper');
    const previewImg = document.getElementById('editCoverPreview');
    
    if (coverInput) {
        coverInput.addEventListener('change', () => {
            const file = coverInput.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    previewImg.src = e.target.result;
                    previewWrapper.classList.remove('d-none');
                };
                reader.readAsDataURL(file);
            }
        });
    }
    
    const editGameForm = document.getElementById('editGameForm');
    if (editGameForm) {
        editGameForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitBtn = editGameForm.querySelector('button[type="submit"]');
            const status = document.getElementById('editStatus');
            
            status.innerText = "Salvando alterações...";
            status.className = "mt-2 text-center small text-warning";
            submitBtn.disabled = true;
            
            const gameId = document.getElementById('editGameId').value;
            const gameTitle = document.getElementById('editGameTitle').value.trim();
            const gameCategory = document.getElementById('editGameCategory').value;
            const city = document.getElementById('editCitySelect').value;
            const school = document.getElementById('editSchoolSelect').value;
            const studentClass = document.getElementById('editClassSelect').value;
            const teacher = document.getElementById('editTeacherSelect').value;
            
            const gameFile = document.getElementById('editGameFile').files[0] || null;
            const coverFile = document.getElementById('editCoverImage').files[0] || null;
            
            if (!gameTitle || !gameCategory || !city || !school || !studentClass || !teacher) {
                status.innerText = "Preencha todos os campos obrigatórios.";
                status.className = "mt-2 text-center small text-danger";
                submitBtn.disabled = false;
                return;
            }
            
            const formData = new FormData();
            formData.append('gameTitle', gameTitle);
            formData.append('gameCategory', gameCategory);
            formData.append('city', city);
            formData.append('school', school);
            formData.append('studentClass', studentClass);
            formData.append('teacher', teacher);
            
            if (gameFile) formData.append('gameFile', gameFile);
            if (coverFile) formData.append('coverImage', coverFile);
            
            const token = localStorage.getItem('student_token');
            const headers = {};
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            try {
                const response = await fetch(`/api/games/${gameId}/update`, {
                    method: 'POST',
                    headers: headers,
                    body: formData
                });
                
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Erro ao atualizar o jogo.');
                
                status.innerText = "Jogo atualizado com sucesso!";
                status.className = "mt-2 text-center small text-success";
                
                setTimeout(() => {
                    const modal = bootstrap.Modal.getInstance(document.getElementById('editModal'));
                    if (modal) modal.hide();
                    status.innerText = "";
                    loadGames();
                }, 1500);
                
            } catch (err) {
                status.innerText = err.message;
                status.className = "mt-2 text-center small text-danger";
            } finally {
                submitBtn.disabled = false;
            }
        });
    }
}