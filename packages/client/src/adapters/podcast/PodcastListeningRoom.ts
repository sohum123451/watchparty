import { PodcastAdapter } from "./PodcastAdapter.js";
import {
  PodcastEpisode,
  PodcastChapter,
  PodcastTranscriptCue,
  PodcastFeed,
} from "./PodcastTypes.js";

export interface PodcastListeningRoomOptions {
  container?: HTMLElement;
  isHost?: boolean;
  onQueueNextEpisode?: (episode: PodcastEpisode) => void;
  onEpisodeSelected?: (episode: PodcastEpisode) => void;
}

export class PodcastListeningRoom {
  private readonly adapter: PodcastAdapter;
  private container: HTMLElement;
  private isHost: boolean;
  private onQueueNextEpisode?: (episode: PodcastEpisode) => void;
  private onEpisodeSelected?: (episode: PodcastEpisode) => void;

  // Web Audio Visualizer state
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private audioSourceNode: MediaElementAudioSourceNode | null = null;
  private animationFrameId: number | null = null;
  private isWebAudioWorking = false;

  // DOM Elements
  private rootElement!: HTMLElement;
  private canvasElement!: HTMLCanvasElement;
  private cssVisualizerElement!: HTMLElement;
  private visualizerModeBadge!: HTMLElement;
  private artworkImage!: HTMLImageElement;
  private ambientGlow!: HTMLElement;
  private podcastTitleEl!: HTMLElement;
  private episodeTitleEl!: HTMLElement;
  private creatorAttributionEl!: HTMLElement;
  private originalLinkEl!: HTMLAnchorElement;
  private chaptersContainer!: HTMLElement;
  private transcriptContainer!: HTMLElement;
  private episodePickerModal!: HTMLElement;
  private episodeListEl!: HTMLElement;
  private episodeSearchInput!: HTMLInputElement;

  // Unsubscribers
  private unsubscribers: Array<() => void> = [];

  constructor(adapter: PodcastAdapter, options: PodcastListeningRoomOptions = {}) {
    this.adapter = adapter;
    this.container = options.container || (typeof document !== "undefined" ? document.body : (null as any));
    this.isHost = options.isHost ?? true;
    this.onQueueNextEpisode = options.onQueueNextEpisode;
    this.onEpisodeSelected = options.onEpisodeSelected;

    if (typeof document !== "undefined" && this.container) {
      this.initDom();
      this.setupSubscriptions();
      this.initVisualizer();
      this.render();
    }
  }

  public setHost(isHost: boolean): void {
    this.isHost = isHost;
    this.updateHostControls();
  }

  private initDom(): void {
    this.rootElement = document.createElement("div");
    this.rootElement.className = "podcast-listening-room";
    this.rootElement.innerHTML = `
      <div class="plr-ambient-glow" id="plrAmbientGlow"></div>
      
      <div class="plr-main-grid">
        <!-- Left: Stage & Artwork -->
        <div class="plr-stage">
          <div class="plr-artwork-wrap">
            <img id="plrArtwork" class="plr-artwork" src="" alt="Podcast Artwork" />
            <div class="plr-visualizer-overlay">
              <canvas id="plrVisualizerCanvas" class="plr-canvas"></canvas>
              <div id="plrCssVisualizer" class="plr-css-visualizer" style="display: none;">
                ${Array.from({ length: 24 }).map((_, i) => `<span class="plr-eq-bar bar-${i % 8}"></span>`).join("")}
              </div>
            </div>
            <div id="plrVisualizerBadge" class="plr-vis-badge">DYNAMIC VISUALIZER</div>
          </div>

          <!-- Metadata & Creator Attribution -->
          <div class="plr-attribution-card">
            <div class="plr-show-title" id="plrPodcastTitle">Podcast Title</div>
            <h1 class="plr-episode-title" id="plrEpisodeTitle">Episode Title</h1>
            
            <div class="plr-creator-row">
              <span class="plr-creator-badge" id="plrCreatorAttribution">Hosted by Creator</span>
              <a id="plrOriginalLink" class="plr-external-link" href="#" target="_blank" rel="noopener noreferrer" title="View original episode page on creator's site">
                Original Page ↗
              </a>
            </div>

            <div class="plr-stream-notice">
              <span class="plr-dot"></span>
              Streaming audio directly from creator host • Unmodified & ad-supported
            </div>

            <!-- Host Actions: Episode Picker & Shared Playlist Feed -->
            <div class="plr-host-bar" id="plrHostBar">
              <button class="plr-btn-primary" id="plrBtnOpenPicker">
                🎙 Browse Episodes
              </button>
              <button class="plr-btn-secondary" id="plrBtnNextEpisode" title="Queue the next episode from this podcast into the shared room playlist">
                ⏭ Next Episode (+ Playlist)
              </button>
            </div>
          </div>
        </div>

        <!-- Right: Tabs (Chapters & Synced Transcript) -->
        <div class="plr-sidebar">
          <div class="plr-tab-header">
            <button class="plr-tab-btn active" id="plrTabChapters">Chapters</button>
            <button class="plr-tab-btn" id="plrTabTranscript">Transcript</button>
          </div>

          <!-- Chapters Pane -->
          <div class="plr-pane active" id="plrPaneChapters">
            <div class="plr-section-label">Podcasting 2.0 / Show Notes Chapters</div>
            <div class="plr-chapter-list" id="plrChapterList">
              <div class="plr-empty-text">No chapters available for this episode</div>
            </div>
          </div>

          <!-- Transcript Pane -->
          <div class="plr-pane" id="plrPaneTranscript" style="display: none;">
            <div class="plr-section-label">Synced Transcript</div>
            <div class="plr-transcript-box" id="plrTranscriptBox">
              <div class="plr-empty-text">No synced transcript found for this episode</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Episode Picker Modal -->
      <div class="plr-modal-overlay" id="plrPickerModal" style="display: none;">
        <div class="plr-modal-card">
          <div class="plr-modal-header">
            <div style="font-weight: 700; font-size: 1.1rem; color: #fff;">Podcast Episodes</div>
            <button class="plr-modal-close" id="plrBtnClosePicker">✕</button>
          </div>
          <div class="plr-search-bar">
            <input type="text" id="plrSearchInput" placeholder="Filter episodes by title or keywords..." />
          </div>
          <div class="plr-episode-list" id="plrEpisodeList">
            <!-- Rendered dynamically -->
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(this.rootElement);

    // Query DOM hooks
    this.ambientGlow = this.rootElement.querySelector("#plrAmbientGlow")!;
    this.artworkImage = this.rootElement.querySelector("#plrArtwork")!;
    this.canvasElement = this.rootElement.querySelector("#plrVisualizerCanvas")!;
    this.cssVisualizerElement = this.rootElement.querySelector("#plrCssVisualizer")!;
    this.visualizerModeBadge = this.rootElement.querySelector("#plrVisualizerBadge")!;
    this.podcastTitleEl = this.rootElement.querySelector("#plrPodcastTitle")!;
    this.episodeTitleEl = this.rootElement.querySelector("#plrEpisodeTitle")!;
    this.creatorAttributionEl = this.rootElement.querySelector("#plrCreatorAttribution")!;
    this.originalLinkEl = this.rootElement.querySelector("#plrOriginalLink") as HTMLAnchorElement;
    this.chaptersContainer = this.rootElement.querySelector("#plrChapterList")!;
    this.transcriptContainer = this.rootElement.querySelector("#plrTranscriptBox")!;
    this.episodePickerModal = this.rootElement.querySelector("#plrPickerModal")!;
    this.episodeListEl = this.rootElement.querySelector("#plrEpisodeList")!;
    this.episodeSearchInput = this.rootElement.querySelector("#plrSearchInput") as HTMLInputElement;

    // Attach internal UI listeners
    this.attachDomEvents();
  }

  private attachDomEvents(): void {
    const tabChapters = this.rootElement.querySelector("#plrTabChapters")!;
    const tabTranscript = this.rootElement.querySelector("#plrTabTranscript")!;
    const paneChapters = this.rootElement.querySelector("#plrPaneChapters") as HTMLElement;
    const paneTranscript = this.rootElement.querySelector("#plrPaneTranscript") as HTMLElement;

    tabChapters.addEventListener("click", () => {
      tabChapters.classList.add("active");
      tabTranscript.classList.remove("active");
      paneChapters.style.display = "block";
      paneTranscript.style.display = "none";
    });

    tabTranscript.addEventListener("click", () => {
      tabTranscript.classList.add("active");
      tabChapters.classList.remove("active");
      paneChapters.style.display = "none";
      paneTranscript.style.display = "block";
    });

    const btnPicker = this.rootElement.querySelector("#plrBtnOpenPicker")!;
    const btnClosePicker = this.rootElement.querySelector("#plrBtnClosePicker")!;
    btnPicker.addEventListener("click", () => this.openEpisodePicker());
    btnClosePicker.addEventListener("click", () => this.closeEpisodePicker());
    this.episodePickerModal.addEventListener("click", (e) => {
      if (e.target === this.episodePickerModal) this.closeEpisodePicker();
    });

    this.episodeSearchInput.addEventListener("input", () => {
      this.filterEpisodes(this.episodeSearchInput.value);
    });

    const btnNext = this.rootElement.querySelector("#plrBtnNextEpisode")!;
    btnNext.addEventListener("click", () => {
      const nextEp = this.adapter.getNextEpisode();
      if (nextEp && this.onQueueNextEpisode) {
        this.onQueueNextEpisode(nextEp);
        this.showToast(`Queued "${nextEp.title}" into shared playlist!`);
      } else if (!nextEp) {
        this.showToast("No further episodes available in this feed.");
      }
    });
  }

  private setupSubscriptions(): void {
    const unsubEp = this.adapter.onEpisodeChange(() => {
      this.render();
    });

    const unsubChap = this.adapter.onChapterChange((activeChapter) => {
      this.highlightActiveChapter(activeChapter);
    });

    const unsubTrans = this.adapter.onTranscriptCueChange((activeCue) => {
      this.highlightActiveTranscriptCue(activeCue);
    });

    const unsubState = this.adapter.onStateChange((state) => {
      if (state === "playing") {
        this.rootElement.classList.add("is-playing");
        this.ensureAudioContextStarted();
      } else {
        this.rootElement.classList.remove("is-playing");
      }
    });

    this.unsubscribers.push(unsubEp, unsubChap, unsubTrans, unsubState);
  }

  // ==========================================
  // AUDIO VISUALIZER (WEB AUDIO + CSS FALLBACK)
  // ==========================================

  private initVisualizer(): void {
    // Attempt Web Audio API with fallback to CSS
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) {
        this.fallbackToCssVisualizer("Web Audio API not supported");
        return;
      }

      const audioEl = this.adapter.getAudioElement();
      if (!audioEl) {
        this.fallbackToCssVisualizer("Audio element not available");
        return;
      }

      const ctx = new AudioCtx();
      this.audioContext = ctx;
      const analyser = ctx.createAnalyser();
      this.analyser = analyser;
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.8;

      try {
        const sourceNode = ctx.createMediaElementSource(audioEl);
        this.audioSourceNode = sourceNode;
        sourceNode.connect(analyser);
        analyser.connect(ctx.destination);
        this.isWebAudioWorking = true;
        this.canvasElement.style.display = "block";
        this.cssVisualizerElement.style.display = "none";
        this.visualizerModeBadge.textContent = "● LIVE AUDIO FFT";
        this.startCanvasRenderLoop();
      } catch (sourceErr: any) {
        // Cross-origin restriction (CORS-less audio)
        this.fallbackToCssVisualizer("CORS restriction on audio source");
      }
    } catch (err: any) {
      this.fallbackToCssVisualizer(err?.message || "Visualizer error");
    }
  }

  private fallbackToCssVisualizer(reason: string): void {
    this.isWebAudioWorking = false;
    this.adapter.setCorsRestricted(true);
    if (this.canvasElement) this.canvasElement.style.display = "none";
    if (this.cssVisualizerElement) this.cssVisualizerElement.style.display = "flex";
    if (this.visualizerModeBadge) {
      this.visualizerModeBadge.textContent = "● DYNAMIC VISUALIZER (CORS FALLBACK)";
      this.visualizerModeBadge.title = `Direct stream without Web Audio analysis (${reason})`;
    }
  }

  private ensureAudioContextStarted(): void {
    if (this.audioContext && this.audioContext.state === "suspended") {
      this.audioContext.resume().catch(() => {});
    }
  }

  private startCanvasRenderLoop(): void {
    if (!this.canvasElement || !this.analyser) return;

    const ctx = this.canvasElement.getContext("2d");
    if (!ctx) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      this.animationFrameId = requestAnimationFrame(draw);

      const width = this.canvasElement.width = this.canvasElement.offsetWidth;
      const height = this.canvasElement.height = this.canvasElement.offsetHeight;

      this.analyser!.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, width, height);

      const barCount = 28;
      const barWidth = (width / barCount) - 3;
      let x = 0;

      for (let i = 0; i < barCount; i++) {
        const val = dataArray[i % bufferLength] || 0;
        const percent = val / 255;
        const barHeight = Math.max(4, percent * height * 0.9);

        // Neon violet to magenta gradient
        const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
        gradient.addColorStop(0, "rgba(99, 102, 241, 0.7)");
        gradient.addColorStop(1, "rgba(236, 72, 153, 0.9)");

        ctx.fillStyle = gradient;
        ctx.fillRect(x, height - barHeight, barWidth, barHeight);

        x += barWidth + 3;
      }
    };

    draw();
  }

  // ==========================================
  // RENDER & UI UPDATES
  // ==========================================

  public render(): void {
    const episode = this.adapter.getCurrentEpisode();
    const feed = this.adapter.getPodcastFeed();

    // Default art fallback
    const defaultArtwork = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 24 24' fill='%236366f1'><rect width='24' height='24' fill='%23111827'/><circle cx='12' cy='12' r='8' fill='%234338ca'/><path d='M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z' fill='%23fff'/><path d='M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z' fill='%23fff'/></svg>";

    const artwork = episode?.artworkUrl || feed?.artworkUrl || defaultArtwork;
    this.artworkImage.src = artwork;
    this.ambientGlow.style.backgroundImage = `url(${artwork})`;

    this.podcastTitleEl.textContent = episode?.podcastTitle || feed?.title || "Podcast Listening Room";
    this.episodeTitleEl.textContent = episode?.title || "Select an episode to begin listening";
    
    const author = episode?.podcastAuthor || feed?.author || "Creator";
    this.creatorAttributionEl.textContent = `Hosted by ${author}`;

    const link = episode?.episodeLink || episode?.podcastLink || feed?.link || "#";
    this.originalLinkEl.href = link;
    this.originalLinkEl.style.display = link && link !== "#" ? "inline-flex" : "none";

    this.renderChapters();
    this.renderTranscript();
    this.updateHostControls();
  }

  private updateHostControls(): void {
    const hostBar = this.rootElement.querySelector("#plrHostBar") as HTMLElement;
    if (hostBar) {
      hostBar.style.display = this.isHost ? "flex" : "none";
    }
  }

  private renderChapters(): void {
    const chapters = this.adapter.getChapters();
    if (!chapters || chapters.length === 0) {
      this.chaptersContainer.innerHTML = `<div class="plr-empty-text">No chapters available for this episode</div>`;
      return;
    }

    this.chaptersContainer.innerHTML = "";
    chapters.forEach((chap, idx) => {
      const row = document.createElement("div");
      row.className = "plr-chapter-row";
      row.dataset.startTimeMs = String(chap.startTimeMs);
      row.innerHTML = `
        <span class="plr-chap-time">${this.formatTime(chap.startTimeMs)}</span>
        <span class="plr-chap-title">${chap.title}</span>
      `;
      row.addEventListener("click", () => {
        this.adapter.seek(chap.startTimeMs);
      });
      this.chaptersContainer.appendChild(row);
    });

    this.highlightActiveChapter(this.adapter.getCurrentChapter());
  }

  private highlightActiveChapter(activeChapter: PodcastChapter | null): void {
    if (!this.chaptersContainer) return;
    const rows = this.chaptersContainer.querySelectorAll(".plr-chapter-row");
    rows.forEach((r) => {
      const st = parseInt((r as HTMLElement).dataset.startTimeMs || "0", 10);
      if (activeChapter && st === activeChapter.startTimeMs) {
        r.classList.add("active");
        r.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else {
        r.classList.remove("active");
      }
    });
  }

  private renderTranscript(): void {
    const cues = this.adapter.getTranscript();
    if (!cues || cues.length === 0) {
      this.transcriptContainer.innerHTML = `<div class="plr-empty-text">No synced transcript available for this episode</div>`;
      return;
    }

    this.transcriptContainer.innerHTML = "";
    cues.forEach((cue) => {
      const item = document.createElement("div");
      item.className = "plr-transcript-cue";
      item.dataset.startMs = String(cue.startTimeMs);
      item.dataset.endMs = String(cue.endTimeMs);

      const speakerHtml = cue.speaker ? `<span class="plr-speaker-badge">${cue.speaker}</span> ` : "";
      item.innerHTML = `
        <span class="plr-cue-time">${this.formatTime(cue.startTimeMs)}</span>
        <div class="plr-cue-body">${speakerHtml}${cue.text}</div>
      `;
      item.addEventListener("click", () => {
        this.adapter.seek(cue.startTimeMs);
      });
      this.transcriptContainer.appendChild(item);
    });

    this.highlightActiveTranscriptCue(this.adapter.getCurrentTranscriptCue());
  }

  private highlightActiveTranscriptCue(activeCue: PodcastTranscriptCue | null): void {
    if (!this.transcriptContainer) return;
    const items = this.transcriptContainer.querySelectorAll(".plr-transcript-cue");
    items.forEach((it) => {
      const st = parseInt((it as HTMLElement).dataset.startMs || "0", 10);
      if (activeCue && st === activeCue.startTimeMs) {
        it.classList.add("active");
        it.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else {
        it.classList.remove("active");
      }
    });
  }

  // ==========================================
  // EPISODE PICKER
  // ==========================================

  public openEpisodePicker(): void {
    this.episodePickerModal.style.display = "flex";
    this.episodeSearchInput.value = "";
    this.renderEpisodeList();
  }

  public closeEpisodePicker(): void {
    this.episodePickerModal.style.display = "none";
  }

  private renderEpisodeList(filterText = ""): void {
    const episodes = this.adapter.getEpisodes();
    this.episodeListEl.innerHTML = "";

    const query = filterText.toLowerCase().trim();
    const filtered = query
      ? episodes.filter(
          (e) =>
            e.title.toLowerCase().includes(query) ||
            (e.description && e.description.toLowerCase().includes(query))
        )
      : episodes;

    if (filtered.length === 0) {
      this.episodeListEl.innerHTML = `<div class="plr-empty-text">No episodes matching "${filterText}"</div>`;
      return;
    }

    const currentGuid = this.adapter.getCurrentEpisode()?.guid;

    filtered.forEach((ep) => {
      const item = document.createElement("div");
      item.className = `plr-ep-card ${ep.guid === currentGuid ? "current" : ""}`;
      item.innerHTML = `
        <div style="flex: 1;">
          <div class="plr-ep-card-title">${ep.title}</div>
          <div class="plr-ep-card-meta">
            ${ep.pubDate ? `<span>📅 ${new Date(ep.pubDate).toLocaleDateString()}</span>` : ""}
            ${ep.durationMs ? `<span>⏱ ${this.formatTime(ep.durationMs)}</span>` : ""}
          </div>
        </div>
        <div class="plr-ep-card-actions">
          <button class="plr-btn-small play-now">Play Now</button>
          <button class="plr-btn-small queue-btn" title="Add to shared room playlist">+ Playlist</button>
        </div>
      `;

      item.querySelector(".play-now")?.addEventListener("click", () => {
        this.adapter.selectEpisode(ep);
        this.closeEpisodePicker();
        if (this.onEpisodeSelected) {
          this.onEpisodeSelected(ep);
        }
      });

      item.querySelector(".queue-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.onQueueNextEpisode) {
          this.onQueueNextEpisode(ep);
          this.showToast(`Added "${ep.title}" to shared playlist!`);
        }
      });

      this.episodeListEl.appendChild(item);
    });
  }

  private filterEpisodes(val: string): void {
    this.renderEpisodeList(val);
  }

  private formatTime(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    const pad = (n: number) => String(n).padStart(2, "0");

    if (hours > 0) {
      return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
  }

  private showToast(msg: string): void {
    const toast = document.createElement("div");
    toast.className = "plr-toast";
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("fade-out");
      setTimeout(() => toast.remove(), 400);
    }, 2500);
  }

  public destroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close().catch(() => {});
    }
    this.unsubscribers.forEach((fn) => fn());
    this.rootElement?.remove();
  }
}
