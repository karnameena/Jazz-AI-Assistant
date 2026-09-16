import "react";

/**
 * Browser API declarations that are implemented by Chromium-based browsers
 * but are not currently included in TypeScript's standard DOM library.
 */
interface SpeechRecognitionConstructor {
  new (): any;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    webkitAudioContext?: typeof AudioContext;
  }
}

/**
 * Jazz passes Lucide icon elements through small presentation components and
 * overrides only their `size` prop. React 19's generic cloneElement overload
 * intentionally treats an unparameterized ReactElement's props as unknown,
 * so expose the narrow, safe overload used by these icon wrappers.
 */
declare module "react" {
  function cloneElement(
    element: ReactElement<unknown>,
    props: { size: number } & Attributes,
    ...children: ReactNode[]
  ): ReactElement;
}

export {};
