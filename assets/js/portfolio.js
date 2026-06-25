// ===== NAVIGATION - Smooth Scroll to Sections =====
document.querySelectorAll('nav ul a, [data-section]').forEach(element => {
    element.addEventListener('click', function(e) {
        e.preventDefault();
        const sectionId = this.dataset.section;
        if (!sectionId) return;

        // Update nav links
        document.querySelectorAll('nav ul a').forEach(link => {
            link.classList.remove('active');
            if (link.dataset.section === sectionId) {
                link.classList.add('active');
            }
        });

        // Show section
        document.querySelectorAll('.section').forEach(section => {
            section.classList.remove('active');
        });
        const targetSection = document.getElementById(sectionId);
        if (targetSection) {
            targetSection.classList.add('active');
        }

        // Close mobile menu
        if (window.innerWidth <= 768) {
            document.querySelector('nav ul').style.display = 'none';
        }

        // Smooth scroll to section
        if (targetSection) {
            const navHeight = document.querySelector('nav').offsetHeight;
            const targetPosition = targetSection.offsetTop - navHeight;
            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
        }
    });
});

// ===== MOBILE MENU =====
const hamburger = document.querySelector('.hamburger');
const navUl = document.querySelector('nav ul');

if (hamburger && navUl) {
    hamburger.addEventListener('click', () => {
        if (navUl.style.display === 'flex') {
            navUl.style.display = 'none';
        } else {
            navUl.style.display = 'flex';
            navUl.style.flexDirection = 'column';
            navUl.style.position = 'absolute';
            navUl.style.top = '100%';
            navUl.style.left = '0';
            navUl.style.width = '100%';
            navUl.style.background = 'rgba(26, 32, 44, 0.98)';
            navUl.style.padding = '1.5rem';
            navUl.style.gap = '1rem';
            navUl.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        }
    });
}

// ===== MP3 PLAYER =====
(function () {
    const audio = document.getElementById('mp3Audio');
    const disc = document.getElementById('mp3Disc');
    const trackTitle = document.getElementById('mp3TrackTitle');
    const trackArtist = document.getElementById('mp3TrackArtist');
    const playBtn = document.getElementById('mp3PlayBtn');
    const playIcon = document.getElementById('mp3PlayIcon');
    const prevBtn = document.getElementById('mp3PrevBtn');
    const nextBtn = document.getElementById('mp3NextBtn');
    const seekBar = document.getElementById('mp3SeekBar');
    const currentTimeEl = document.getElementById('mp3CurrentTime');
    const durationEl = document.getElementById('mp3Duration');
    const volumeBar = document.getElementById('mp3VolumeBar');
    const playlistEl = document.getElementById('mp3Playlist');

    if (!audio) return;

    let playlist = [];
    let currentIndex = 0;
    let isSeeking = false;

    const ICON_PLAY = '<path d="M8 5v14l11-7z"/>';
    const ICON_PAUSE = '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>';

    function formatTime(sec) {
        if (!isFinite(sec) || isNaN(sec)) return "0:00";
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60).toString().padStart(2, "0");
        return `${m}:${s}`;
    }

    function formatTrackName(filename) {
        let name = filename.replace(/\.[^.]+$/, "");
        name = name.replace(/[_-]/g, " ");
        name = name.replace(/\b\w/g, l => l.toUpperCase());
        return name;
    }

    function renderPlaylist() {
        playlistEl.innerHTML = "";
        if (playlist.length === 0) {
            playlistEl.innerHTML = `
                <div style="padding: 12px; text-align: center; color: #718096; font-size: 0.85rem;">
                    No audio files found
                </div>
            `;
            return;
        }
        playlist.forEach((track, i) => {
            const item = document.createElement("div");
            item.className = "playlist-item" + (i === currentIndex ? " active" : "");
            item.innerHTML = `
                <span class="playlist-index">${(i + 1).toString().padStart(2, "0")}</span>
                <span class="playlist-name">${track.title}</span>
                <span class="playlist-artist">${track.artist}</span>
            `;
            item.addEventListener("click", () => loadTrack(i, true));
            playlistEl.appendChild(item);
        });
    }

    function loadTrack(index, autoplay) {
        if (playlist.length === 0) return;
        currentIndex = (index + playlist.length) % playlist.length;
        const track = playlist[currentIndex];
        audio.src = track.src;
        trackTitle.textContent = track.title;
        trackArtist.textContent = track.artist;
        renderPlaylist();
        if (autoplay) {
            audio.play().catch(() => {});
        }
    }

    function updatePlayUI() {
        const playing = !audio.paused && !audio.ended;
        playIcon.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
        disc.classList.toggle("spinning", playing);
    }

    async function loadPlaylist() {
        try {
            const response = await fetch('assets/audio/playlist.json');
            if (!response.ok) throw new Error('Playlist not found');
            const files = await response.json();

            if (files && files.length > 0) {
                playlist = files.map(file => ({
                    title: formatTrackName(file),
                    artist: "Me",
                    src: `assets/audio/${encodeURIComponent(file)}`
                }));
                renderPlaylist();
                loadTrack(0, false);
            }
        } catch (error) {
            console.log('Playlist not loaded:', error);
        }
    }

    // Event Listeners
    playBtn.addEventListener("click", () => {
        if (playlist.length === 0) return;
        if (!audio.src) loadTrack(0, false);
        if (audio.paused) audio.play().catch(() => {});
        else audio.pause();
    });

    prevBtn.addEventListener("click", () => {
        if (playlist.length === 0) return;
        loadTrack(currentIndex - 1, true);
    });

    nextBtn.addEventListener("click", () => {
        if (playlist.length === 0) return;
        loadTrack(currentIndex + 1, true);
    });

    audio.addEventListener("play", updatePlayUI);
    audio.addEventListener("pause", updatePlayUI);
    audio.addEventListener("ended", () => {
        if (playlist.length > 0) loadTrack(currentIndex + 1, true);
    });

    audio.addEventListener("loadedmetadata", () => {
        if (audio.duration && isFinite(audio.duration)) {
            seekBar.max = audio.duration;
            durationEl.textContent = formatTime(audio.duration);
        }
    });

    audio.addEventListener("timeupdate", () => {
        if (!isSeeking && audio.duration && isFinite(audio.duration)) {
            seekBar.value = audio.currentTime;
            currentTimeEl.textContent = formatTime(audio.currentTime);
        }
    });

    seekBar.addEventListener("input", () => {
        isSeeking = true;
        currentTimeEl.textContent = formatTime(parseFloat(seekBar.value));
    });

    seekBar.addEventListener("change", () => {
        audio.currentTime = parseFloat(seekBar.value);
        isSeeking = false;
    });

    volumeBar.addEventListener("input", () => {
        audio.volume = parseFloat(volumeBar.value);
    });
    audio.volume = parseFloat(volumeBar.value);

    loadPlaylist();
})();

// ===== ACTIVE NAV HIGHLIGHT ON SCROLL =====
let isScrolling = false;
const sections = ['home', 'about', 'financial', 'contact'];

window.addEventListener('scroll', () => {
    if (isScrolling) return;
    isScrolling = true;

    requestAnimationFrame(() => {
        const navHeight = document.querySelector('nav').offsetHeight;
        const scrollPosition = window.scrollY + navHeight + 50;

        for (const sectionId of sections) {
            const section = document.getElementById(sectionId);
            if (section) {
                const sectionTop = section.offsetTop;
                const sectionBottom = sectionTop + section.offsetHeight;

                if (scrollPosition >= sectionTop && scrollPosition < sectionBottom) {
                    document.querySelectorAll('nav ul a').forEach(link => {
                        link.classList.remove('active');
                        if (link.dataset.section === sectionId) {
                            link.classList.add('active');
                        }
                    });
                    break;
                }
            }
        }
        isScrolling = false;
    });
}, { passive: true });

// ===== FINANCIAL HUB TABS =====
document.querySelectorAll('.hub-tab').forEach(tab => {
    tab.addEventListener('click', function() {
        document.querySelectorAll('.hub-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');

        const tabId = this.dataset.hub;
        document.querySelectorAll('.hub-panel').forEach(p => p.classList.remove('active'));
        const targetPanel = document.getElementById('hub-' + tabId);
        if (targetPanel) {
            targetPanel.classList.add('active');
        }
    });
});