import { VideoProvider } from "@watchparty/shared";
import { PlayerAdapter } from "./PlayerAdapter.js";
import { HTML5Adapter, HTML5AdapterOptions } from "./HTML5Adapter.js";
import { YouTubeAdapter, YouTubeAdapterOptions } from "./YouTubeAdapter.js";
import { VimeoAdapter, VimeoAdapterOptions } from "./VimeoAdapter.js";
import { LocalFileAdapter, LocalFileAdapterOptions } from "./LocalFileAdapter.js";
import { ScreenShareAdapter, ScreenShareAdapterOptions } from "./ScreenShareAdapter.js";
import { PodcastAdapter, PodcastAdapterOptions } from "./PodcastAdapter.js";
import { EmbedAdapter, EmbedAdapterOptions } from "./embed/index.js";
import { CoBrowseAdapter, CoBrowseAdapterOptions } from "../cobrowse/index.js";

export type AdapterOptionsMap = {
  html5: HTML5AdapterOptions;
  youtube: YouTubeAdapterOptions;
  vimeo: VimeoAdapterOptions;
  local: LocalFileAdapterOptions;
  screenshare: ScreenShareAdapterOptions;
  podcast: PodcastAdapterOptions;
  embed: EmbedAdapterOptions;
  soundcloud: EmbedAdapterOptions;
  spotify: EmbedAdapterOptions;
  "co-browse": CoBrowseAdapterOptions;
};

export class AdapterFactory {
  public static createAdapter(provider: VideoProvider, options: any = {}): PlayerAdapter {
    switch (provider) {
      case "youtube":
        return new YouTubeAdapter(options);
      case "vimeo":
        return new VimeoAdapter(options);
      case "local":
        return new LocalFileAdapter(options);
      case "screenshare":
        return new ScreenShareAdapter(options);
      case "podcast":
        return new PodcastAdapter(options);
      case "embed":
      case "soundcloud":
      case "spotify":
        return new EmbedAdapter(options);
      case "co-browse":
        return new CoBrowseAdapter(options);
      case "html5":
      default:
        return new HTML5Adapter(options);
    }
  }
}
