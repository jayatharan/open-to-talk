import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_SCREEN_QUALITY, screenQualityPreset, type RoomSecret, type ScreenQuality } from "@open2talk/core";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const HOST_KEY = "open2talk:host";
const NAME_KEY = "open2talk:displayName";
const SCREEN_QUALITY_KEY = "open2talk:screenQuality";

interface SettingsValue {
  loaded: boolean;
  host: string;
  displayName: string;
  setHost: (host: string) => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
  screenQuality: ScreenQuality;
  setScreenQuality: (quality: ScreenQuality) => Promise<void>;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [host, setHostState] = useState("");
  const [displayName, setNameState] = useState("");
  const [screenQuality, setScreenQualityState] = useState<ScreenQuality>(DEFAULT_SCREEN_QUALITY);

  useEffect(() => {
    void AsyncStorage.multiGet([HOST_KEY, NAME_KEY, SCREEN_QUALITY_KEY]).then(([[, h], [, n], [, q]]) => {
      setHostState(h ?? "");
      setNameState(n ?? "");
      setScreenQualityState(screenQualityPreset(q).id);
      setLoaded(true);
    });
  }, []);

  const setHost = useCallback(async (h: string) => {
    setHostState(h);
    await AsyncStorage.setItem(HOST_KEY, h);
  }, []);

  const setDisplayName = useCallback(async (n: string) => {
    setNameState(n);
    await AsyncStorage.setItem(NAME_KEY, n);
  }, []);

  const setScreenQuality = useCallback(async (q: ScreenQuality) => {
    setScreenQualityState(q);
    await AsyncStorage.setItem(SCREEN_QUALITY_KEY, q);
  }, []);

  return (
    <SettingsContext.Provider value={{ loaded, host, displayName, setHost, setDisplayName, screenQuality, setScreenQuality }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}

/** In-memory hand-off so a room's creator can join without retyping the password. */
const secrets = new Map<string, RoomSecret>();
export const rememberSecret = (slug: string, s: RoomSecret) => secrets.set(slug, s);
export function takeSecret(slug: string): RoomSecret | undefined {
  const s = secrets.get(slug);
  secrets.delete(slug);
  return s;
}
