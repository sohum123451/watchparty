import {
  RelativeReadingPosition,
  W3CTextQuoteSelector,
  SharedHighlight,
  StickyComment,
  MemberReadingPresence,
  SectionPing,
  CoBrowseMediaState,
  CoBrowseSession,
} from "@watchparty/shared";

export interface CoBrowseOptions {
  url?: string;
  title?: string;
  frameAllowed?: boolean;
  isHost?: boolean;
  iframeElement?: HTMLIFrameElement | any;
  containerElement?: HTMLElement | any;
  onScrollChange?: (position: RelativeReadingPosition) => void;
  onHighlightAdd?: (highlight: SharedHighlight) => void;
  onHighlightRemove?: (highlightId: string) => void;
  onCommentAdd?: (comment: StickyComment) => void;
  onNotesUpdate?: (text: string, version: number) => void;
  onSectionPing?: (ping: SectionPing) => void;
  onPresenceUpdate?: (presence: MemberReadingPresence) => void;
  onMediaSync?: (state: CoBrowseMediaState) => void;
  onFollowHostChange?: (following: boolean) => void;
}

export interface ReadingAnchorMatch {
  element: HTMLElement | any;
  selector: string;
  snippet: string;
  offsetTop: number;
  height: number;
}
