import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Avatar, Box, Typography } from "@mui/material";
import { api } from "../../api/api";
import type { ChatProps } from "../../types/modules";
import { speak, stop, getVoices } from "../../utils/tts";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAUSE_MS = 2000;
const DISPLAY_MS = 5000;
const IMAGE_DISPLAY_MS = 60000;
const MESSAGES_SINCE_DAYS = 50;
const FONT = "'Atkinson Hyperlegible', sans-serif";

const READING_RATE: Record<string, number> = { slow: 0.7, normal: 1.0, fast: 1.4 };

const FONT_SIZE = {
  small:  { header: "2rem",   body: "1.8rem", bubbleMaxH: "calc(100vh - 200px)" },
  medium: { header: "3rem",   body: "2.5rem", bubbleMaxH: "calc(100vh - 220px)" },
  large:  { header: "4rem",   body: "3.2rem", bubbleMaxH: "calc(100vh - 260px)" },
};

const FEMALE_HINTS = /katja|anna|helena|petra|female|weiblich/i;
const MALE_HINTS   = /stefan|markus|conrad|hans|yannick|male|männlich/i;

// ─── Types ────────────────────────────────────────────────────────────────────

type MessageType = "text" | "image" | "audio";

interface Message {
  id: string;
  user_id: string;
  username: string;
  sender_media_id?: string;
  content: string;
  type: MessageType;
  media_id?: string;
  created_at: string;
}

interface ModuleDataEntry {
  id: string;
  module_id: string;
  data: {
    user_id: string;
    content: string;
    type?: MessageType;
    media_id?: string;
  };
  created_at: string;
}

interface UserPublicProfile {
  id: string;
  name: string | null;
  media_id: string | null;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useMessages(moduleId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ModuleDataEntry[]>(`/modules/${moduleId}/data`)
      .then(async (entries) => {
        const base = entries
          .reverse()
          .slice(-MESSAGES_SINCE_DAYS)
          .map((e) => ({
            id: e.id,
            user_id: e.data.user_id,
            username: "",
            sender_media_id: undefined as string | undefined,
            content: e.data.content,
            type: (e.data.type ?? "text") as MessageType,
            media_id: e.data.media_id,
            created_at: e.created_at,
          }));

        const uniqueIds = [...new Set(base.map((m) => m.user_id).filter(Boolean))];
        const profileMap = new Map<string, UserPublicProfile>();
        await Promise.all(
          uniqueIds.map((id) =>
            api
              .get<UserPublicProfile>(`/users/${id}`)
              .then((p) => profileMap.set(id, p))
              .catch(() => {}),
          ),
        );

        setMessages(
          base.map((m) => ({
            ...m,
            username: profileMap.get(m.user_id)?.name || "Unbekannt",
            sender_media_id: profileMap.get(m.user_id)?.media_id ?? undefined,
          })),
        );
      })
      .catch((err) => {
        setError((err as Error).message);
      })
      .finally(() => setLoading(false));
  }, [moduleId]);

  return { messages, loading, error };
}

function useVoice(pref: "male" | "female" | undefined): SpeechSynthesisVoice | undefined {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | undefined>();
  useEffect(() => {
    if (!pref) return;
    const pick = () => {
      const german = getVoices().filter((v) => v.lang.startsWith("de"));
      if (!german.length) return;
      const hints    = pref === "female" ? FEMALE_HINTS : MALE_HINTS;
      const opposite = pref === "female" ? MALE_HINTS   : FEMALE_HINTS;
      setVoice(
        german.find((v) => hints.test(v.name)) ??
        german.find((v) => !opposite.test(v.name)) ??
        german[0],
      );
    };
    pick();
    window.speechSynthesis.onvoiceschanged = pick;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [pref]);
  return voice;
}

function useMediaBlobUrl(mediaId: string | undefined): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mediaId) { setBlobUrl(null); return; }
    let cancelled = false;
    api.getBlob(`/media/${mediaId}`).then((url) => {
      if (cancelled || !url) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setBlobUrl(url);
    }).catch(() => {});
    return () => {
      cancelled = true;
      setBlobUrl(null);
      urlRef.current = null;
    };
  }, [mediaId]);
  return blobUrl;
}

function useShutdownRequest(
  onShutdownRequest: ChatProps["onShutdownRequest"],
  onModuleDone: ChatProps["onModuleDone"],
  audioRef: React.RefObject<HTMLAudioElement | null>,
) {
  const interruptDoneRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onShutdownRequest?.(() => {
      const ttsSpeaking = window.speechSynthesis.speaking;
      const audioPlaying = audioRef.current != null && !audioRef.current.paused;
      if (ttsSpeaking || audioPlaying) {
        interruptDoneRef.current = () => onModuleDone?.();
      } else {
        onModuleDone?.();
      }
    });
  }, [onShutdownRequest, onModuleDone, audioRef]);

  return interruptDoneRef;
}

function speakMessage(
  msg: Message,
  onEnd: () => void,
  bubbleRef: React.RefObject<HTMLDivElement | null>,
  rate: number,
  voice?: SpeechSynthesisVoice,
) {
  const prefix = `Nachricht von ${msg.username || "Unbekannt"}. `;
  speak(prefix + msg.content, {
    rate,
    voice,
    onEnd,
    onBoundary: (event) => {
      const el = bubbleRef.current;
      if (!el || el.scrollHeight <= el.clientHeight) return;
      const contentIndex = event.charIndex - prefix.length;
      if (contentIndex < 0) return;
      el.scrollTop = (contentIndex / msg.content.length) * (el.scrollHeight - el.clientHeight);
    },
  });
}

function loadResumeIndex(moduleId: string): number {
  try {
    return Math.max(0, parseInt(localStorage.getItem(`chat-resume-${moduleId}`) ?? "0", 10) || 0);
  } catch {
    return 0;
  }
}

function saveResumeIndex(moduleId: string, index: number): void {
  try {
    localStorage.setItem(`chat-resume-${moduleId}`, String(index));
  } catch { /* ignore */ }
}

function useMessagePlayback(params: {
  moduleId: string;
  messages: Message[];
  loading: boolean;
  audio: boolean;
  rate: number;
  ttsVoice?: SpeechSynthesisVoice;
  bubbleRef: React.RefObject<HTMLDivElement | null>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  onShutdownRequest: ChatProps["onShutdownRequest"];
  onModuleDone: ChatProps["onModuleDone"];
}) {
  const { moduleId, messages, loading, audio, rate, ttsVoice, bubbleRef, audioRef, onShutdownRequest, onModuleDone } = params;
  const [index, setIndex] = useState(0);

  const indexRef = useRef(0);
  const messagesRef = useRef<Message[]>([]);
  const resumeApplied = useRef(false);
  useEffect(() => { indexRef.current = index; }, [index]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    if (loading || messages.length === 0 || resumeApplied.current) return;
    resumeApplied.current = true;
    const saved = loadResumeIndex(moduleId);
    const next = saved + 1;
    if (saved > 0 && next < messages.length) setIndex(next);
  }, [loading, messages.length, moduleId]);

  useEffect(() => {
    return () => {
      const cur = indexRef.current;
      const total = messagesRef.current.length;
      if (total === 0) return;
      saveResumeIndex(moduleId, cur >= total ? 0 : cur);
    };
  }, [moduleId]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interruptDoneRef = useShutdownRequest(onShutdownRequest, onModuleDone, audioRef);

  const rateRef = useRef(rate);
  const ttsVoiceRef = useRef(ttsVoice);
  useEffect(() => { rateRef.current = rate; }, [rate]);
  useEffect(() => { ttsVoiceRef.current = ttsVoice; }, [ttsVoice]);

  const currentMediaId = messages[index]?.media_id;
  const mediaBlobUrl = useMediaBlobUrl(currentMediaId);

  const mediaBlobUrlRef = useRef<string | null>(null);
  const triggerAudioRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    mediaBlobUrlRef.current = mediaBlobUrl;
    if (mediaBlobUrl && triggerAudioRef.current) {
      const trigger = triggerAudioRef.current;
      triggerAudioRef.current = null;
      trigger();
    }
  }, [mediaBlobUrl]);

  useEffect(() => {
    if (loading || messages.length === 0 || index >= messages.length) return;

    if (bubbleRef.current) bubbleRef.current.scrollTop = 0;

    const advance = () => {
      timerRef.current = setTimeout(() => setIndex((i) => i + 1), PAUSE_MS);
    };

    const onEnd = () => {
      if (interruptDoneRef.current) {
        interruptDoneRef.current();
        interruptDoneRef.current = null;
      } else {
        advance();
      }
    };

    const msg = messages[index];
    const name = msg.username || "Unbekannt";

    if (msg.type === "text") {
      if (audio) {
        speakMessage(msg, onEnd, bubbleRef, rateRef.current, ttsVoiceRef.current);
      } else {
        timerRef.current = setTimeout(advance, DISPLAY_MS);
      }
    } else if (msg.type === "image") {
      if (audio) {
        speak(`Bild von ${name}.`, {
          rate: rateRef.current,
          voice: ttsVoiceRef.current,
          onEnd: () => { timerRef.current = setTimeout(onEnd, IMAGE_DISPLAY_MS); },
        });
      } else {
        timerRef.current = setTimeout(advance, IMAGE_DISPLAY_MS);
      }
    } else if (msg.type === "audio") {
      const el = audioRef.current;
      if (!el) return;

      const playAudio = () => {
        const url = mediaBlobUrlRef.current;
        if (!url) { onEnd(); return; }
        el.src = url;
        el.currentTime = 0;
        el.onended = onEnd;
        el.oncanplay = () => { el.oncanplay = null; el.play().catch(onEnd); };
        el.load();
      };

      const doPlayback = () => {
        if (audio) {
          speak(`Sprachnachricht von ${name}.`, { rate: rateRef.current, voice: ttsVoiceRef.current, onEnd: playAudio });
        } else {
          playAudio();
        }
      };

      if (mediaBlobUrlRef.current) {
        doPlayback();
      } else {
        triggerAudioRef.current = doPlayback;
      }
    } else {
      timerRef.current = setTimeout(advance, DISPLAY_MS);
    }

    return () => {
      triggerAudioRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (audioRef.current) {
        audioRef.current.onended = null;
        audioRef.current.oncanplay = null;
        audioRef.current.pause();
        audioRef.current.src = "";
      }
      stop();
    };
  }, [index, messages, loading, audio, bubbleRef, audioRef, interruptDoneRef]);

  return { index, mediaBlobUrl };
}

// ─── Theme ────────────────────────────────────────────────────────────────────

type ThemeColors = { bg: string; text: string; bubbleBg: string; bubbleBorder: string; bubbleText: string };

const CHAT_COLORS: Record<"light" | "dark", ThemeColors> = {
  light: { bg: "white",   text: "black",   bubbleBg: "white", bubbleBorder: "black", bubbleText: "black" },
  dark:  { bg: "#18181b", text: "#f4f4f5", bubbleBg: "white", bubbleBorder: "white", bubbleText: "black" },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusScreen({ text, colors }: { text: string; colors: ThemeColors }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", bgcolor: colors.bg }}>
      <Typography sx={{ fontFamily: FONT, fontSize: "2rem", color: colors.text }}>{text}</Typography>
    </Box>
  );
}

function SenderAvatar({ username, senderMediaId, sx }: { username: string; senderMediaId?: string; sx?: object }) {
  const blobUrl = useMediaBlobUrl(senderMediaId);
  return (
    <Avatar
      src={blobUrl ?? undefined}
      sx={{
        width: "clamp(9rem, 14vw, 14rem)",
        height: "clamp(9rem, 14vw, 14rem)",
        fontSize: "clamp(3.5rem, 5vw, 5rem)",
        fontFamily: FONT,
        flexShrink: 0,
        bgcolor: "grey.300",
        color: "grey.800",
        ...sx,
      }}
    >
      {!blobUrl && username.charAt(0).toUpperCase()}
    </Avatar>
  );
}

function ChatBubble({ content, bubbleRef, bodyFontSize = "2.5rem", maxHeight = "calc(100vh - 220px)", colors }: { content: string; bubbleRef: React.RefObject<HTMLDivElement | null>; bodyFontSize?: string; maxHeight?: string; colors: ThemeColors }) {
  const isDark = colors.bubbleBorder === colors.bubbleBg;
  return (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <Box
        ref={bubbleRef}
        sx={{
          bgcolor: colors.bubbleBg,
          color: colors.bubbleText,
          border: `4px solid ${colors.bubbleBorder}`,
          borderRadius: "24px",
          p: 5,
          overflowY: "auto",
          maxHeight,
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
          boxSizing: "border-box",
        }}
      >
        <Typography sx={{ fontFamily: FONT, fontSize: bodyFontSize, lineHeight: 1.5, textAlign: "left" }}>
          {content}
        </Typography>
      </Box>
      <svg
        style={{ display: "block", marginTop: -4, marginLeft: 40, flexShrink: 0, ...(isDark ? { overflow: "visible" } : {}) }}
        viewBox="0 0 28 22"
        width="28"
        height="22"
      >
        <path d="M 0 0 L 14 22 L 28 0 Z" fill={colors.bubbleBg} stroke={colors.bubbleBorder} strokeWidth="4" strokeLinejoin="round" />
        <rect x="-1" y="-1" width="30" height="5" fill={colors.bubbleBg} />
      </svg>
    </Box>
  );
}

function TextMessage({ msg, bubbleRef, fontSize = "medium", colors }: { msg: Message; bubbleRef: React.RefObject<HTMLDivElement | null>; fontSize?: keyof typeof FONT_SIZE; colors: ThemeColors }) {
  const sizes = FONT_SIZE[fontSize];
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", px: 6, bgcolor: colors.bg }}>
      <Typography sx={{ fontFamily: FONT, fontSize: sizes.header, fontWeight: 600, color: colors.text, pt: 4, pb: 4, flexShrink: 0 }}>
        Nachricht von {msg.username || "Unbekannt"}
      </Typography>
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", pb: 6 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 6, width: "100%", maxWidth: 1000 }}>
          <ChatBubble content={msg.content} bubbleRef={bubbleRef} bodyFontSize={sizes.body} maxHeight={sizes.bubbleMaxH} colors={colors} />
          <SenderAvatar username={msg.username || "Unbekannt"} senderMediaId={msg.sender_media_id} />
        </Box>
      </Box>
    </Box>
  );
}

function ImageMessage({ msg, blobUrl, colors }: { msg: Message; blobUrl: string | null; colors: ThemeColors }) {
  const name = msg.username || "Unbekannt";
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", px: 6, bgcolor: colors.bg }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3, pt: 4, pb: 3, flexShrink: 0 }}>
        <SenderAvatar
          username={name}
          senderMediaId={msg.sender_media_id}
          sx={{ width: "clamp(3.5rem, 6vw, 5rem)", height: "clamp(3.5rem, 6vw, 5rem)", fontSize: "clamp(1.5rem, 2.5vw, 2.2rem)" }}
        />
        <Typography sx={{ fontFamily: FONT, fontSize: "3rem", fontWeight: 600, color: colors.text }}>
          Bild von {name}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", pb: 6, overflow: "hidden" }}>
        {blobUrl && (
          <Box
            component="img"
            src={blobUrl}
            alt={`Bild von ${name}`}
            sx={{
              maxWidth: "100%",
              maxHeight: "100%",
              borderRadius: "24px",
              objectFit: "contain",
              display: "block",
            }}
          />
        )}
      </Box>
    </Box>
  );
}

function AudioMessage({ msg, colors }: { msg: Message; colors: ThemeColors }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", px: 6, bgcolor: colors.bg }}>
      <Typography sx={{ fontFamily: FONT, fontSize: "3rem", fontWeight: 600, color: colors.text, pt: 4, pb: 4, flexShrink: 0 }}>
        Sprachnachricht von {msg.username || "Unbekannt"}
      </Typography>
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", pb: 6 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Box sx={{ color: colors.text, flexShrink: 0, width: "clamp(12rem, 30vw, 24rem)", height: "clamp(12rem, 30vw, 24rem)" }}>
            <svg width="100%" height="100%" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
              <path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
          </Box>
          <SenderAvatar username={msg.username || "Unbekannt"} senderMediaId={msg.sender_media_id} />
        </Box>
      </Box>
    </Box>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function Chat({ module_id, audio, voice, fontSize = "medium", readingSpeed = "normal", theme = "light", onShutdownRequest, onModuleDone }: ChatProps) {
  const { messages, loading, error } = useMessages(module_id);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ttsVoice = useVoice(audio ? voice : undefined);
  const rate = READING_RATE[readingSpeed] ?? 1.0;
  const colors = CHAT_COLORS[theme];

  const { index, mediaBlobUrl } = useMessagePlayback({
    moduleId: module_id,
    messages,
    loading,
    audio,
    rate,
    ttsVoice,
    bubbleRef,
    audioRef,
    onShutdownRequest,
    onModuleDone,
  });

  useEffect(() => {
    if (!loading && (messages.length === 0 || index >= messages.length)) {
      onModuleDone?.();
    }
  }, [loading, messages.length, index, onModuleDone]);

  if (loading) return <StatusScreen text="Lade Nachrichten..." colors={colors} />;
  if (error && messages.length === 0) return <StatusScreen text={`Fehler: ${error}`} colors={colors} />;
  if (messages.length === 0 || index >= messages.length) return null;

  const msg = messages[index];

  return (
    <>
      {/* Permanent audio element — never unmounts so playback isn't interrupted */}
      <audio ref={audioRef} preload="auto" style={{ display: "none" }} />
      {msg.type === "image" ? <ImageMessage msg={msg} blobUrl={mediaBlobUrl} colors={colors} /> :
       msg.type === "audio" ? <AudioMessage msg={msg} colors={colors} /> :
       <TextMessage msg={msg} bubbleRef={bubbleRef} fontSize={fontSize} colors={colors} />}
    </>
  );
}

export default Chat;