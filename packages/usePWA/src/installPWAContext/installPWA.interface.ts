import { JSX, ReactNode } from 'react';

export interface InstallPWAContextProviderProps {
  children: ReactNode;
  component?: 'banner' | 'popup' | 'tooltip' | JSX.Element;
  installPromptTimeout?: number;
}

/**
 * This is part of the standard DOM types in TypeScript
 * @link https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>;
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export type Action =
  | { type: 'SET_PROMPT'; payload: BeforeInstallPromptEvent | null }
  | { type: 'UPDATE_INSTALLATION_STATUS'; payload: boolean }
  | { type: 'CLEANUP' };

export interface InstallPWA {
  deferredPrompt: BeforeInstallPromptEvent | null;
  isInstalling: boolean;
  installPWADispatch: React.Dispatch<Action>;
}

export type State = InstallPWA;
