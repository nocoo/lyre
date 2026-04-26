
import { Moon, Sun, Monitor } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  type Theme,
  getStoredTheme,
  getSystemTheme,
  cycleTheme,
} from "@/lib/theme-utils";

const THEME_CHANGE_EVENT = "theme-change";

function applyTheme(theme: Theme) {
  const applied = theme === "system" ? getSystemTheme() : theme;
  document.documentElement.classList.toggle("dark", applied === "dark");
  localStorage.setItem("theme", theme);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function subscribeToTheme(callback: () => void) {
  // Re-render on manual toggle
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  // Re-render on OS-level color scheme change
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (getStoredTheme() === "system") {
      applyTheme("system");
    }
    callback();
  };
  mediaQuery.addEventListener("change", handler);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
    mediaQuery.removeEventListener("change", handler);
  };
}

function getSnapshot(): Theme {
  return getStoredTheme();
}

function getServerSnapshot(): Theme {
  return "system";
}

const ICON_PROPS = {
  className: "h-4 w-4",
  "aria-hidden": true as const,
  strokeWidth: 1.5,
};

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getSnapshot,
    getServerSnapshot,
  );

  const handleCycle = useCallback(() => {
    applyTheme(cycleTheme(theme));
  }, [theme]);

  return (
    <Button variant="ghost" size="icon" onClick={handleCycle}>
      {theme === "system" ? (
        <Monitor {...ICON_PROPS} />
      ) : theme === "dark" ? (
        <Moon {...ICON_PROPS} />
      ) : (
        <Sun {...ICON_PROPS} />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
