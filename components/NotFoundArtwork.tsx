'use client';

/** The shop app's 404 artwork, so private entry points are placed on the very picture staff will click. Keep in step with jewellery-erp/src/components/common/NotFoundArtwork.tsx. */
import { useId } from 'react';

export function NotFoundArtwork() {
  const id = useId().replaceAll(':', '');
  return <svg viewBox="0 0 640 440" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${id}-gold`} x1="250" y1="80" x2="400" y2="330" gradientUnits="userSpaceOnUse"><stop stopColor="#F6DF9D" /><stop offset=".45" stopColor="#C4953C" /><stop offset=".7" stopColor="#FFF0C1" /><stop offset="1" stopColor="#AA792C" /></linearGradient>
      <radialGradient id={`${id}-halo`}><stop stopColor="#E1EAE1" /><stop offset="1" stopColor="#F7F8F4" stopOpacity="0" /></radialGradient>
      <pattern id={`${id}-grid`} width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" stroke="#A8B9A6" strokeWidth="1.2" /></pattern>
    </defs>
    <rect width="640" height="440" fill={`url(#${id}-grid)`} opacity=".5" />
    <circle cx="320" cy="215" r="202" fill={`url(#${id}-halo)`} />
    <circle cx="320" cy="216" r="169" stroke="#D7DFD3" />
    <path d="M120 216H520M320 34V398" stroke="#D7DFD3" strokeDasharray="3 9" />
    <ellipse cx="320" cy="361" rx="169" ry="14" fill="#0D3B2F" opacity=".06" />
    <text x="64" y="306" fill="#173F33" fontFamily="Georgia, serif" fontSize="240" letterSpacing="-18">4</text>
    <text x="417" y="306" fill="#173F33" fontFamily="Georgia, serif" fontSize="240" letterSpacing="-18">4</text>
    <ellipse cx="321" cy="234" rx="77" ry="99" stroke="#8D652B" strokeWidth="18" />
    <ellipse cx="320" cy="231" rx="77" ry="99" stroke={`url(#${id}-gold)`} strokeWidth="13" />
    <path d="M286 123L302 100H338L354 123L320 158L286 123Z" fill="#0D3B2F" stroke={`url(#${id}-gold)`} strokeWidth="4" />
    <path d="M286 123H354M302 100L307 123L320 158L333 123L338 100M307 123L320 100L333 123" stroke="#87AA95" strokeWidth="1.5" />
    <path d="M185 103V123M175 113H195M458 327V347M448 337H468" stroke="#B79048" strokeWidth="2" strokeLinecap="round" />
    <circle cx="492" cy="121" r="4" fill="#B79048" /><circle cx="151" cy="324" r="3" fill="#B79048" />
    <path d="M258 373H382" stroke="#D5C9AB" strokeLinecap="round" />
  </svg>;
}
