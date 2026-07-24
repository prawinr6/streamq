const CONFIG = {
    BASE_URL: 'https://www.googleapis.com/youtube/v3',
    STORAGE_KEY: 'streamq_yt_api_key',
    CACHE_EXPIRY: { TRENDING: 1000 * 60 * 60 * 3, SEARCH: 1000 * 60 * 60 * 24 }
};

// --- KEY & CACHE MANAGERS ---
const KeyManager = {
    getKey: () => localStorage.getItem(CONFIG.STORAGE_KEY) || '',
    setKey: (key) => { localStorage.setItem(CONFIG.STORAGE_KEY, key.trim()); CacheManager.clearAll(); UI.updateStatusBadge(); },
    clearKey: () => { localStorage.removeItem(CONFIG.STORAGE_KEY); CacheManager.clearAll(); UI.updateStatusBadge(); UI.showModalMessage('Cleared.', 'info'); document.getElementById('apiKeyInput').value = ''; },
    saveKeyFromUI: () => {
        const input = document.getElementById('apiKeyInput').value.trim();
        if (!input) return UI.showModalMessage('Enter valid key.', 'error');
        KeyManager.setKey(input);
        UI.showModalMessage('Saved! Reloading...', 'success');
        setTimeout(() => { UI.closeModal(); UI.loadHome(); }, 1200);
    }
};

const CacheManager = {
    set: (key, data, ttl) => localStorage.setItem(key, JSON.stringify({ data, expiry: Date.now() + ttl })),
    get: (key) => {
        const itemStr = localStorage.getItem(key);
        if (!itemStr) return null;
        try {
            const item = JSON.parse(itemStr);
            if (Date.now() > item.expiry) { localStorage.removeItem(key); return null; }
            return item.data;
        } catch { return null; }
    },
    clearAll: () => Object.keys(localStorage).forEach(k => { if (k.startsWith('yt_')) localStorage.removeItem(k); })
};

// --- LIBRARY MANAGER (History & Saved Data) ---
const LibraryManager = {
    saveToHistory: (videoObj) => {
        let history = JSON.parse(localStorage.getItem('yt_history') || '[]');
        history = history.filter(v => v.id !== videoObj.id); 
        history.unshift(videoObj); 
        if (history.length > 50) history.pop(); 
        localStorage.setItem('yt_history', JSON.stringify(history));
    },
    getHistory: () => JSON.parse(localStorage.getItem('yt_history') || '[]'),
    toggleSaved: (videoObj) => {
        let saved = JSON.parse(localStorage.getItem('yt_saved') || '[]');
        const exists = saved.find(v => v.id === videoObj.id);
        if (exists) saved = saved.filter(v => v.id !== videoObj.id);
        else saved.unshift(videoObj);
        localStorage.setItem('yt_saved', JSON.stringify(saved));
        return !exists; 
    },
    isSaved: (videoId) => JSON.parse(localStorage.getItem('yt_saved') || '[]').some(v => v.id === videoId),
    getSaved: () => JSON.parse(localStorage.getItem('yt_saved') || '[]')
};

// --- YOUTUBE API SERVICE ---
const YouTubeAPI = {
    async fetchWithKey(endpoint) {
        const apiKey = KeyManager.getKey();
        if (!apiKey) { UI.promptForKey('No API Key found.'); return null; }
        const res = await fetch(`${CONFIG.BASE_URL}${endpoint}&key=${apiKey}`);
        const data = await res.json();
        if (!res.ok) {
            if (res.status === 400 || res.status === 403) UI.promptForKey(`API Error: ${data.error?.message}`);
            throw new Error(data.error?.message);
        }
        return data;
    },

    async getTrending() {
        const cacheKey = 'yt_trending_all'; // Updated cache key to reflect unfiltered data
        const cached = CacheManager.get(cacheKey);
        if (cached) return cached;
        try {
            const data = await this.fetchWithKey('/videos?part=snippet,status&chart=mostPopular&maxResults=40');
            if (data && data.items) {
                // MODIFIED: Removed strict filters for embeddable and publicStatsViewable statuses
                const playable = data.items.slice(0, 16);
                CacheManager.set(cacheKey, playable, CONFIG.CACHE_EXPIRY.TRENDING);
                return playable;
            }
            return [];
        } catch (error) { return []; }
    },

    async search(query, isLive = false) {
        if (!query) return [];
        const cacheKey = `yt_search_${query.replace(/\s+/g, '').toLowerCase()}_${isLive}_all`;
        const cached = CacheManager.get(cacheKey);
        if (cached) return cached;
        
        try {
            let endpoint = `/search?part=snippet&q=${encodeURIComponent(query)}&type=video&safeSearch=moderate&maxResults=24`;
            
            // MODIFIED: Removed '&videoEmbeddable=true&videoSyndicated=true' restrictions
            if (isLive) {
                endpoint += '&eventType=live';
            }
            
            const data = await this.fetchWithKey(endpoint);
            if (data && data.items) {
                CacheManager.set(cacheKey, data.items, CONFIG.CACHE_EXPIRY.SEARCH);
                return data.items;
            }
            return [];
        } catch (error) { return []; }
    }
};

// --- UI CONTROLLER ---
const UI = {
    grid: document.getElementById('videoGrid'),
    playerView: document.getElementById('playerView'),
    loader: document.getElementById('loader'),
    searchInput: document.getElementById('searchInput'),
    title: document.getElementById('pageTitle'),
    currentVideoObj: null,

    // Modal Methods
    modal: document.getElementById('apiKeyModal'),
    modalMsg: document.getElementById('modalMessage'),
    statusBadge: document.getElementById('keyStatusBadge'),
    updateStatusBadge() { this.statusBadge.className = `w-2 h-2 rounded-full ${KeyManager.getKey() ? 'bg-green-500' : 'bg-red-500'}`; },
    openModal() { document.getElementById('apiKeyInput').value = KeyManager.getKey(); this.modalMsg.classList.add('hidden'); this.modal.classList.remove('hidden'); this.modal.classList.add('flex'); },
    closeModal() { this.modal.classList.add('hidden'); this.modal.classList.remove('flex'); },
    showModalMessage(msg, type) { 
        this.modalMsg.textContent = msg; 
        this.modalMsg.className = `text-xs py-2 px-3 rounded-lg mt-2 ${type === 'error' ? 'bg-red-900/50 text-red-300' : type === 'success' ? 'bg-green-900/50 text-green-300' : 'bg-blue-900/50 text-blue-300'}`;
    },
    promptForKey(reason) { this.showLoader(false); this.openModal(); this.showModalMessage(reason, 'error'); },

    // State Methods
    showLoader(show) { this.loader.classList.toggle('hidden', !show); if (show) this.grid.innerHTML = ''; },
    setActiveMenu(id) {
        document.querySelectorAll('.nav-link').forEach(el => {
            el.classList.remove('bg-gray-800', 'text-red-500');
            el.classList.add('text-gray-400');
        });
        const active = document.getElementById(id);
        if (active) {
            active.classList.remove('text-gray-400');
            active.classList.add('bg-gray-800', 'text-red-500');
        }
        
        // NEW: Automatically close sidebar on mobile after clicking a link
        const sidebar = document.getElementById('sidebar');
        if (sidebar && window.innerWidth < 768) {
            sidebar.classList.add('hidden');
        }
    },

    // View Loaders
    async loadHome() {
        this.setActiveMenu('nav-home');
        this.resetView('Recommended For You');
        const videos = await YouTubeAPI.getTrending();
        this.renderGrid(videos);
    },
    async loadTrending() {
        this.setActiveMenu('nav-trending');
        this.resetView('Global Trending');
        const videos = await YouTubeAPI.search('Trending viral 2026'); 
        this.renderGrid(videos);
    },
    async loadExplore() {
        this.setActiveMenu('nav-explore');
        this.resetView('Explore Topics');
        // Standard video discovery
        const videos = await YouTubeAPI.search('Documentary travel technology');
        this.renderGrid(videos);
    },
    async loadLive() {
        this.setActiveMenu('nav-live');
        this.resetView('<span class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-red-500 animate-pulse"></span> Happening Now</span>');
        // Explicitly searches for live broadcasts
        const videos = await YouTubeAPI.search('live news sports gaming lo-fi', true);
        this.renderGrid(videos);
    },
    loadHistory() {
        this.setActiveMenu('nav-history');
        this.resetView('Watch History');
        this.renderGrid(LibraryManager.getHistory(), true);
    },
    loadSaved() {
        this.setActiveMenu('nav-saved');
        this.resetView('Saved to Library');
        this.renderGrid(LibraryManager.getSaved(), true);
    },
    async handleSearch(query) {
        this.setActiveMenu(''); 
        this.resetView(`Search Results for "${query}"`);
        const isLiveQuery = query.toLowerCase().includes('live');
        const videos = await YouTubeAPI.search(query, isLiveQuery);
        this.renderGrid(videos);
    },

    resetView(titleHTML) {
        this.playerView.classList.add('hidden');
        this.grid.classList.remove('hidden');
        this.title.innerHTML = titleHTML;
        this.title.classList.remove('hidden');
        this.showLoader(true);
        window.scrollTo({ top: 0 });
    },

    renderGrid(videos, isLibraryFormat = false) {
        this.showLoader(false);
        this.grid.innerHTML = '';

        if (!videos || videos.length === 0) {
            this.grid.innerHTML = `<div class="col-span-full text-center text-gray-500 py-16"><p>No playable videos found for this category.</p></div>`;
            return;
        }

        videos.forEach(video => {
            const videoId = isLibraryFormat ? video.id : (video.id.videoId || video.id);
            const snippet = video.snippet;
            const thumbnailUrl = snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || 'https://via.placeholder.com/640x360.png?text=No+Image';
            
            // Check if the video is currently broadcasting live
            const isLive = snippet.liveBroadcastContent === 'live';
            const liveBadgeHTML = isLive ? `<div class="absolute bottom-2 right-2 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide flex items-center gap-1"><span class="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>Live</div>` : '';

            const card = document.createElement('div');
            card.className = 'video-card group cursor-pointer flex flex-col gap-3';
            card.onclick = () => this.openPlayer(videoId, snippet);

            card.innerHTML = `
                <div class="thumbnail-wrapper relative w-full aspect-video bg-gray-800 rounded-xl overflow-hidden">
                    <img src="${thumbnailUrl}" class="thumbnail-img w-full h-full object-cover" onload="this.classList.add('loaded')">
                    <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all"></div>
                    ${liveBadgeHTML}
                </div>
                <div class="flex gap-3 px-1">
                    <div class="flex-1 min-w-0">
                        <h3 class="text-sm font-semibold text-white line-clamp-2 leading-snug group-hover:text-red-400 transition-colors">${snippet.title}</h3>
                        <p class="text-xs text-gray-400 mt-1 hover:text-white transition">${snippet.channelTitle}</p>
                    </div>
                </div>`;
            this.grid.appendChild(card);
        });
    },

    openPlayer(videoId, snippet) {
        this.grid.classList.add('hidden');
        this.title.classList.add('hidden');
        this.playerView.classList.remove('hidden');
        
        const videoData = { id: videoId, snippet: snippet };
        this.currentVideoObj = videoData;
        LibraryManager.saveToHistory(videoData);
        this.updateSaveButtonUI(LibraryManager.isSaved(videoId));

        const player = document.getElementById('videoPlayer');
        const currentOrigin = (window.location.hostname === '' || window.location.hostname === 'localhost') ? 'https://localhost' : window.location.origin;
        player.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&origin=${currentOrigin}`;
        
        document.getElementById('videoTitle').textContent = snippet.title;
        document.getElementById('videoChannel').textContent = snippet.channelTitle;
        document.getElementById('contentArea').scrollTo({ top: 0, behavior: 'smooth' });
    },

    closePlayer() {
        document.getElementById('videoPlayer').src = ''; 
        this.playerView.classList.add('hidden');
        this.grid.classList.remove('hidden');
        this.title.classList.remove('hidden');
        this.currentVideoObj = null;
    },

    toggleSaveCurrentVideo() {
        if (!this.currentVideoObj) return;
        const isNowSaved = LibraryManager.toggleSaved(this.currentVideoObj);
        this.updateSaveButtonUI(isNowSaved);
    },

    updateSaveButtonUI(isSaved) {
        const btn = document.getElementById('saveBtn');
        if (isSaved) {
            btn.innerHTML = `<i class="fa-solid fa-bookmark text-red-500"></i> <span class="text-red-500">Saved</span>`;
            btn.classList.add('border-red-500');
        } else {
            btn.innerHTML = `<i class="fa-regular fa-bookmark"></i> <span>Save</span>`;
            btn.classList.remove('border-red-500');
        }
    }
};

let searchTimeout;
UI.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    searchTimeout = setTimeout(() => {
        if (query.length > 2) UI.handleSearch(query);
        else if (query.length === 0) UI.loadHome();
    }, 800);
});

document.addEventListener('DOMContentLoaded', () => {
    UI.updateStatusBadge();
    if (!KeyManager.getKey()) UI.openModal();
    else UI.loadHome();
});
