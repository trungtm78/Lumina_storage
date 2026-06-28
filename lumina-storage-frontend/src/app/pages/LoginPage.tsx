import { useState, useEffect, useCallback } from "react";
import {
  User,
  Lock,
  ChevronLeft,
  ChevronRight,
  Check,
  Sparkles,
  Globe,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { PasswordInput } from "@/app/components/password-input";
import { useLogin } from "@/app/hooks/useAuth";
import { useBranding, useAppTitle } from "@/app/contexts/BrandingContext";
import { useLanguage } from "@/app/hooks/useLanguage";
import { useAuthStore } from "@/app/stores/authStore";
import { toast } from "sonner";

const REMEMBERED_USERNAME_KEY = "lumina_remembered_username";
const SSO_SERVICE_URL = import.meta.env.VITE_SSO_SERVICE_URL?.trim() || "";
const SSO_APP = import.meta.env.VITE_SSO_APP?.trim() || "storage";
const MS_CLIENT_ID = (import.meta.env.VITE_ENTRA_STORAGE_FE_CLIENT_ID as string)?.trim() || "";

// ═══════════════════════════════════════════════════════
// SHARED SVG DEFS (gradients, filters reused across illustrations)
// ═══════════════════════════════════════════════════════
function SvgDefs() {
  return (
    <defs>
      <linearGradient id="cardWhite" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#f1f5fb" />
      </linearGradient>
      <linearGradient id="cardBlue" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#e8f0fe" />
        <stop offset="100%" stopColor="#d2e3fc" />
      </linearGradient>
      <linearGradient id="cardViolet" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#f0ecff" />
        <stop offset="100%" stopColor="#e0d7ff" />
      </linearGradient>
      <linearGradient id="cardCyan" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#e0f7fa" />
        <stop offset="100%" stopColor="#b2ebf2" />
      </linearGradient>
      <linearGradient id="cardRed" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#fff0f2" />
        <stop offset="100%" stopColor="#ffd6dc" />
      </linearGradient>
      <radialGradient id="aiGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#c8b4ff" stopOpacity="0.6" />
        <stop offset="60%" stopColor="#a78bfa" stopOpacity="0.2" />
        <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="coreGrad" cx="50%" cy="30%" r="70%">
        <stop offset="0%" stopColor="#ede9fe" />
        <stop offset="100%" stopColor="#c4b5fd" />
      </radialGradient>
      <radialGradient id="hubGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.5" />
        <stop offset="100%" stopColor="#67e8f9" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="redAccent" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fca5a5" stopOpacity="0.5" />
        <stop offset="100%" stopColor="#fca5a5" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0.5" />
        <stop offset="100%" stopColor="#e2e8f0" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="lineArea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#818cf8" stopOpacity="0.35" />
        <stop offset="100%" stopColor="#818cf8" stopOpacity="0.0" />
      </linearGradient>
      <linearGradient id="lineAreaCyan" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.3" />
        <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
      </linearGradient>
      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow
          dx="0"
          dy="4"
          stdDeviation="6"
          floodColor="#94a3b8"
          floodOpacity="0.18"
        />
      </filter>
      <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow
          dx="0"
          dy="6"
          stdDeviation="10"
          floodColor="#64748b"
          floodOpacity="0.12"
        />
      </filter>
      <filter id="glowFilter" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

// ═══════════════════════════════════════════════════════
// ILLUSTRATION 1 — LUMINA CORE
// ═══════════════════════════════════════════════════════
function IllustrationCore() {
  return (
    <svg
      viewBox="0 0 480 360"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-full w-full"
    >
      <SvgDefs />
      <ellipse cx="240" cy="295" rx="175" ry="28" fill="url(#floor)" />
      <ellipse cx="240" cy="190" rx="100" ry="80" fill="url(#aiGlow)" />
      <ellipse cx="240" cy="226" rx="44" ry="12" fill="#a78bfa" opacity="0.2" />
      <rect
        x="200"
        y="176"
        width="80"
        height="48"
        rx="14"
        fill="url(#coreGrad)"
        filter="url(#softShadow)"
      />
      <rect x="203" y="178" width="74" height="42" rx="12" fill="#ede9fe" />
      <rect
        x="215"
        y="190"
        width="50"
        height="2"
        rx="1"
        fill="#a78bfa"
        opacity="0.6"
      />
      <rect
        x="215"
        y="195"
        width="36"
        height="2"
        rx="1"
        fill="#a78bfa"
        opacity="0.4"
      />
      <rect
        x="215"
        y="200"
        width="44"
        height="2"
        rx="1"
        fill="#a78bfa"
        opacity="0.5"
      />
      <rect
        x="215"
        y="205"
        width="28"
        height="2"
        rx="1"
        fill="#c4b5fd"
        opacity="0.4"
      />
      <circle cx="240" cy="200" r="10" fill="#a78bfa" opacity="0.25" />
      <circle cx="240" cy="200" r="6" fill="#7c3aed" opacity="0.7" />
      <circle cx="240" cy="200" r="3" fill="white" opacity="0.9" />
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={210 + i * 18}
          y="222"
          width="4"
          height="6"
          rx="1"
          fill="#c4b5fd"
        />
      ))}
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={210 + i * 18}
          y="170"
          width="4"
          height="6"
          rx="1"
          fill="#c4b5fd"
        />
      ))}
      <path
        d="M220 182 Q180 160 128 148"
        stroke="#a78bfa"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        opacity="0.5"
        fill="none"
      />
      <circle cx="128" cy="148" r="3" fill="#a78bfa" opacity="0.6" />
      <path
        d="M260 182 Q300 160 352 148"
        stroke="#818cf8"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        opacity="0.5"
        fill="none"
      />
      <circle cx="352" cy="148" r="3" fill="#818cf8" opacity="0.6" />
      <path
        d="M214 220 Q170 240 110 248"
        stroke="#22d3ee"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        opacity="0.4"
        fill="none"
      />
      <circle cx="110" cy="248" r="3" fill="#22d3ee" opacity="0.5" />
      <path
        d="M266 220 Q310 240 366 248"
        stroke="#34d399"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        opacity="0.4"
        fill="none"
      />
      <circle cx="366" cy="248" r="3" fill="#34d399" opacity="0.5" />
      <path
        d="M280 200 Q340 200 370 195"
        stroke="#c5001d"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        opacity="0.3"
        fill="none"
      />
      <g filter="url(#cardShadow)" transform="translate(68,82)">
        <rect width="128" height="88" rx="12" fill="url(#cardWhite)" />
        <rect width="128" height="22" rx="12" fill="url(#cardBlue)" />
        <rect y="12" width="128" height="10" fill="url(#cardBlue)" />
        <rect
          x="8"
          y="7"
          width="40"
          height="8"
          rx="4"
          fill="#93c5fd"
          opacity="0.7"
        />
        <circle cx="114" cy="11" r="4" fill="#c5001d" opacity="0.5" />
        <circle cx="114" cy="11" r="2" fill="#c5001d" />
        <path
          d="M8 72 L24 60 L40 64 L56 48 L72 52 L88 38 L104 44 L120 32 L120 80 L8 80 Z"
          fill="url(#lineArea)"
        />
        <path
          d="M8 72 L24 60 L40 64 L56 48 L72 52 L88 38 L104 44 L120 32"
          stroke="#818cf8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle
          cx="88"
          cy="38"
          r="3.5"
          fill="white"
          stroke="#818cf8"
          strokeWidth="1.5"
        />
        {[40, 55, 70].map((y, i) => (
          <line
            key={i}
            x1="6"
            y1={y}
            x2="10"
            y2={y}
            stroke="#cbd5e1"
            strokeWidth="1"
          />
        ))}
      </g>
      <g filter="url(#cardShadow)" transform="translate(286,82)">
        <rect width="120" height="88" rx="12" fill="url(#cardWhite)" />
        <rect width="120" height="22" rx="12" fill="url(#cardViolet)" />
        <rect y="12" width="120" height="10" fill="url(#cardViolet)" />
        <rect
          x="8"
          y="7"
          width="48"
          height="8"
          rx="4"
          fill="#c4b5fd"
          opacity="0.7"
        />
        {[
          { x: 12, h: 28, c: "#818cf8" },
          { x: 26, h: 40, c: "#a78bfa" },
          { x: 40, h: 22, c: "#818cf8" },
          { x: 54, h: 48, c: "#7c3aed" },
          { x: 68, h: 34, c: "#818cf8" },
          { x: 82, h: 52, c: "#a78bfa" },
          { x: 96, h: 30, c: "#c4b5fd" },
        ].map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={80 - b.h}
            width="10"
            height={b.h}
            rx="3"
            fill={b.c}
            opacity="0.75"
          />
        ))}
      </g>
      <g filter="url(#cardShadow)" transform="translate(42,222)">
        <rect width="136" height="76" rx="12" fill="url(#cardWhite)" />
        <rect width="136" height="20" rx="12" fill="url(#cardCyan)" />
        <rect y="12" width="136" height="8" fill="url(#cardCyan)" />
        <rect
          x="8"
          y="5"
          width="52"
          height="10"
          rx="4"
          fill="#67e8f9"
          opacity="0.6"
        />
        <path
          d="M10 65 L28 56 L46 59 L64 50 L82 53 L100 44 L118 47 L126 42 L126 70 L10 70 Z"
          fill="url(#lineAreaCyan)"
        />
        <path
          d="M10 65 L28 56 L46 59 L64 50 L82 53 L100 44 L118 47 L126 42"
          stroke="#22d3ee"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {[
          [28, 56],
          [64, 50],
          [100, 44],
        ].map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="2.5"
            fill="white"
            stroke="#22d3ee"
            strokeWidth="1.5"
          />
        ))}
      </g>
      <g filter="url(#cardShadow)" transform="translate(300,222)">
        <rect width="130" height="76" rx="12" fill="url(#cardWhite)" />
        <rect width="130" height="20" rx="12" fill="url(#cardRed)" />
        <rect y="12" width="130" height="8" fill="url(#cardRed)" />
        <rect
          x="8"
          y="5"
          width="44"
          height="10"
          rx="4"
          fill="#fca5a5"
          opacity="0.6"
        />
        <circle
          cx="42"
          cy="52"
          r="18"
          fill="none"
          stroke="#f1f5f9"
          strokeWidth="8"
        />
        <circle
          cx="42"
          cy="52"
          r="18"
          fill="none"
          stroke="#818cf8"
          strokeWidth="8"
          strokeDasharray="70 43"
          strokeDashoffset="-8"
          strokeLinecap="round"
        />
        <circle
          cx="42"
          cy="52"
          r="18"
          fill="none"
          stroke="#c5001d"
          strokeWidth="8"
          strokeDasharray="22 91"
          strokeDashoffset="-78"
          strokeLinecap="round"
          opacity="0.6"
        />
        <circle cx="42" cy="52" r="10" fill="white" />
        <rect x="72" y="34" width="8" height="8" rx="2" fill="#818cf8" />
        <rect x="84" y="36" width="36" height="5" rx="2.5" fill="#e2e8f0" />
        <rect
          x="72"
          y="48"
          width="8"
          height="8"
          rx="2"
          fill="#c5001d"
          opacity="0.6"
        />
        <rect x="84" y="50" width="28" height="5" rx="2.5" fill="#e2e8f0" />
        <rect
          x="72"
          y="62"
          width="8"
          height="8"
          rx="2"
          fill="#f1f5f9"
          stroke="#e2e8f0"
          strokeWidth="1"
        />
        <rect x="84" y="64" width="32" height="5" rx="2.5" fill="#e2e8f0" />
      </g>
      <g filter="url(#softShadow)" transform="translate(386,168)">
        <rect width="76" height="52" rx="10" fill="url(#cardRed)" />
        <circle cx="38" cy="20" r="10" fill="#fee2e2" />
        <path d="M38 14 L41 21 L35 21 Z" fill="#c5001d" opacity="0.7" />
        <rect
          x="10"
          y="34"
          width="56"
          height="5"
          rx="2.5"
          fill="#fca5a5"
          opacity="0.5"
        />
        <rect
          x="18"
          y="42"
          width="40"
          height="5"
          rx="2.5"
          fill="#fca5a5"
          opacity="0.3"
        />
      </g>
      {[
        [155, 105],
        [330, 105],
        [168, 258],
        [314, 268],
        [240, 148],
      ].map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={i === 4 ? 2 : 1.5}
          fill="#a78bfa"
          opacity={0.5 - i * 0.05}
        />
      ))}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════
// ILLUSTRATION 2 — LUMINA STORAGE
// ═══════════════════════════════════════════════════════
function IllustrationStorage() {
  return (
    <svg
      viewBox="0 0 480 360"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-full w-full"
    >
      <SvgDefs />
      <defs>
        <linearGradient id="docGrad1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f0f4ff" />
        </linearGradient>
        <linearGradient id="folderGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fef9c3" />
          <stop offset="100%" stopColor="#fde68a" />
        </linearGradient>
        <linearGradient id="lockGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#dcfce7" />
          <stop offset="100%" stopColor="#bbf7d0" />
        </linearGradient>
        <radialGradient id="sparkGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="240" cy="300" rx="170" ry="22" fill="url(#floor)" />
      <g opacity="0.35">
        <rect
          x="148"
          y="105"
          width="185"
          height="235"
          rx="14"
          fill="#e0e7ff"
          transform="rotate(-5 240 220)"
        />
        <rect
          x="148"
          y="105"
          width="185"
          height="235"
          rx="14"
          fill="#dbeafe"
          transform="rotate(-2.5 240 220)"
        />
      </g>
      <g filter="url(#cardShadow)">
        <rect
          x="148"
          y="78"
          width="185"
          height="235"
          rx="14"
          fill="url(#docGrad1)"
        />
        <rect
          x="148"
          y="78"
          width="185"
          height="32"
          rx="14"
          fill="url(#cardBlue)"
        />
        <rect x="148" y="96" width="185" height="14" fill="url(#cardBlue)" />
        <circle cx="168" cy="94" r="4.5" fill="#93c5fd" opacity="0.8" />
        <circle cx="182" cy="94" r="4.5" fill="#bfdbfe" opacity="0.8" />
        <circle cx="196" cy="94" r="4.5" fill="#dbeafe" opacity="0.8" />
        <rect x="164" y="126" width="100" height="7" rx="3.5" fill="#cbd5e1" />
        <line
          x1="164"
          y1="142"
          x2="316"
          y2="142"
          stroke="#e2e8f0"
          strokeWidth="1"
        />
        {[150, 162, 174, 186, 198, 210, 222, 234, 246].map((y, i) => (
          <rect
            key={i}
            x="164"
            y={y}
            width={i % 3 === 0 ? 140 : i % 3 === 1 ? 110 : 125}
            height="6"
            rx="3"
            fill="#e2e8f0"
            opacity="0.8"
          />
        ))}
        <line
          x1="164"
          y1="262"
          x2="260"
          y2="262"
          stroke="#cbd5e1"
          strokeWidth="1"
        />
        <path
          d="M164 256 Q176 248 188 258 Q200 268 212 256 Q220 250 228 256"
          stroke="#818cf8"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <rect x="268" y="252" width="52" height="22" rx="7" fill="#c5001d" />
        <rect
          x="270"
          y="254"
          width="48"
          height="18"
          rx="6"
          fill="#c5001d"
          opacity="0.7"
          stroke="white"
          strokeWidth="0.5"
          strokeDasharray="2 2"
        />
      </g>
      <ellipse
        cx="240"
        cy="196"
        rx="110"
        ry="130"
        fill="url(#sparkGlow)"
        opacity="0.4"
      />
      <g filter="url(#softShadow)" transform="translate(342,86) rotate(6)">
        <rect width="92" height="112" rx="10" fill="url(#cardWhite)" />
        <rect width="92" height="18" rx="10" fill="url(#cardViolet)" />
        <rect y="10" width="92" height="8" fill="url(#cardViolet)" />
        <path d="M78 0 L92 0 L92 14 Z" fill="#c4b5fd" opacity="0.5" />
        {[28, 38, 48, 58, 68, 78, 88].map((y, i) => (
          <rect
            key={i}
            x="10"
            y={y}
            width={i % 2 === 0 ? 60 : 44}
            height="5"
            rx="2.5"
            fill="#e2e8f0"
          />
        ))}
        <g transform="translate(62,92)">
          {[0, 60, 120, 180, 240, 300].map((deg, i) => (
            <line
              key={i}
              x1="0"
              y1="0"
              x2={Math.cos((deg * Math.PI) / 180) * 7}
              y2={Math.sin((deg * Math.PI) / 180) * 7}
              stroke="#a78bfa"
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.7"
            />
          ))}
          <circle cx="0" cy="0" r="3" fill="#a78bfa" />
        </g>
      </g>
      <g filter="url(#softShadow)" transform="translate(68,230)">
        <rect
          x="0"
          y="0"
          width="55"
          height="12"
          rx="6"
          fill="url(#folderGrad)"
        />
        <rect
          x="0"
          y="8"
          width="108"
          height="72"
          rx="8"
          fill="url(#folderGrad)"
        />
        <rect
          x="6"
          y="14"
          width="96"
          height="60"
          rx="6"
          fill="#fef08a"
          opacity="0.4"
        />
        {[24, 34, 44, 54, 62].map((y, i) => (
          <rect
            key={i}
            x="12"
            y={y}
            width={i % 2 === 0 ? 68 : 50}
            height="5"
            rx="2.5"
            fill="white"
            opacity="0.6"
          />
        ))}
        <circle cx="88" cy="48" r="12" fill="white" opacity="0.8" />
        <rect x="82" y="48" width="12" height="9" rx="2" fill="#34d399" />
        <path
          d="M83 47 Q83 42 88 42 Q93 42 93 47"
          stroke="#34d399"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <rect x="86" y="51" width="4" height="4" rx="1" fill="white" />
      </g>
      <g filter="url(#softShadow)" transform="translate(340,244)">
        <rect width="96" height="64" rx="10" fill="url(#lockGrad)" />
        <path
          d="M48 14 L60 20 L60 36 Q60 44 48 50 Q36 44 36 36 L36 20 Z"
          fill="#4ade80"
          opacity="0.6"
        />
        <path
          d="M48 14 L60 20 L60 36 Q60 44 48 50 Q36 44 36 36 L36 20 Z"
          fill="none"
          stroke="#16a34a"
          strokeWidth="1.5"
        />
        <path
          d="M42 32 L46 36 L54 27"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      {[
        [132, 96, 5],
        [358, 200, 4],
        [152, 278, 3],
        [344, 130, 4],
        [240, 72, 5],
        [178, 172, 3],
      ].map(([x, y, r], i) => (
        <g key={i} transform={`translate(${x},${y})`}>
          {[0, 72, 144, 216, 288].map((deg, j) => (
            <line
              key={j}
              x1="0"
              y1="0"
              x2={Math.cos((deg * Math.PI) / 180) * (r - 1)}
              y2={Math.sin((deg * Math.PI) / 180) * (r - 1)}
              stroke="#a78bfa"
              strokeWidth="1"
              strokeLinecap="round"
              opacity={0.4 + j * 0.08}
            />
          ))}
          <circle cx="0" cy="0" r={r / 2} fill="#c4b5fd" opacity="0.8" />
        </g>
      ))}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════
// ILLUSTRATION 3 — LUMINA CARE
// ═══════════════════════════════════════════════════════
function IllustrationCare() {
  return (
    <svg
      viewBox="0 0 480 360"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-full w-full"
    >
      <SvgDefs />
      <defs>
        <linearGradient id="chatOutGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
        <radialGradient id="hubCenter" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#bfdbfe" />
          <stop offset="100%" stopColor="#93c5fd" />
        </radialGradient>
      </defs>
      <ellipse cx="240" cy="298" rx="165" ry="22" fill="url(#floor)" />
      <circle cx="240" cy="186" r="70" fill="url(#hubGlow)" opacity="0.35" />
      <circle cx="240" cy="186" r="52" fill="url(#hubCenter)" opacity="0.4" />
      <circle
        cx="240"
        cy="186"
        r="36"
        fill="url(#cardBlue)"
        filter="url(#softShadow)"
      />
      <circle cx="240" cy="186" r="28" fill="white" />
      <path
        d="M228 182 Q228 172 240 172 Q252 172 252 182"
        stroke="#3b82f6"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
      <rect x="224" y="182" width="8" height="12" rx="4" fill="#3b82f6" />
      <rect x="248" y="182" width="8" height="12" rx="4" fill="#3b82f6" />
      <path
        d="M250 193 Q252 200 246 202 L240 202"
        stroke="#3b82f6"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <circle
        cx="240"
        cy="186"
        r="68"
        stroke="#bfdbfe"
        strokeWidth="1"
        strokeDasharray="5 5"
        opacity="0.6"
      />
      <circle
        cx="240"
        cy="186"
        r="96"
        stroke="#ddd6fe"
        strokeWidth="1"
        strokeDasharray="4 6"
        opacity="0.4"
      />
      {[
        { angle: 0, color: "#818cf8", bg: "url(#cardViolet)" },
        { angle: 60, color: "#22d3ee", bg: "url(#cardCyan)" },
        { angle: 120, color: "#34d399", bg: "url(#lockGrad)" },
        { angle: 180, color: "#a78bfa", bg: "url(#cardBlue)" },
        { angle: 240, color: "#f472b6", bg: "url(#cardRed)" },
        { angle: 300, color: "#fbbf24", bg: "url(#folderGrad)" },
      ].map(({ angle, color, bg }, i) => {
        const rad = (angle * Math.PI) / 180;
        const r = 100;
        const cx = 240 + r * Math.cos(rad);
        const cy = 186 + r * Math.sin(rad);
        const lx1 = 240 + 38 * Math.cos(rad);
        const ly1 = 186 + 38 * Math.sin(rad);
        const lx2 = cx - 22 * Math.cos(rad);
        const ly2 = cy - 22 * Math.sin(rad);
        return (
          <g key={i}>
            <line
              x1={lx1}
              y1={ly1}
              x2={lx2}
              y2={ly2}
              stroke={color}
              strokeWidth="1.5"
              strokeDasharray="3 2"
              opacity="0.5"
            />
            <circle cx={cx} cy={cy} r="3" fill={color} opacity="0.6" />
            <circle
              cx={cx}
              cy={cy}
              r="22"
              fill="white"
              filter="url(#softShadow)"
            />
            <circle cx={cx} cy={cy} r="20" fill={bg} opacity="0.6" />
            {i === 0 && (
              <path
                d={`M${cx - 8} ${cy - 4} Q${cx - 8} ${cy - 10} ${cx} ${cy - 10} Q${cx + 8} ${cy - 10} ${cx + 8} ${cy - 4} Q${cx + 8} ${cy + 2} ${cx} ${cy + 2} L${cx - 4} ${cy + 6} L${cx - 4} ${cy + 2} Q${cx - 8} ${cy + 2} ${cx - 8} ${cy - 4} Z`}
                fill={color}
                opacity="0.7"
              />
            )}
            {i === 1 && (
              <>
                <rect
                  x={cx - 8}
                  y={cy - 7}
                  width="16"
                  height="12"
                  rx="3"
                  fill="none"
                  stroke={color}
                  strokeWidth="1.5"
                />
                <polyline
                  points={`${cx - 8},${cy - 7} ${cx},${cy} ${cx + 8},${cy - 7}`}
                  stroke={color}
                  strokeWidth="1.5"
                  fill="none"
                />
              </>
            )}
            {i === 2 && (
              <circle
                cx={cx}
                cy={cy}
                r="8"
                fill="none"
                stroke={color}
                strokeWidth="1.5"
              />
            )}
            {i === 3 && (
              <>
                <circle cx={cx} cy={cy} r="6" fill={color} opacity="0.8" />
                <circle cx={cx} cy={cy} r="3" fill="white" />
              </>
            )}
            {i === 4 && (
              <path
                d={`M${cx - 6} ${cy - 6} Q${cx - 8} ${cy} ${cx - 4} ${cy + 4} Q${cx} ${cy + 8} ${cx + 4} ${cy + 4} Q${cx + 8} ${cy} ${cx + 6} ${cy - 6} Q${cx + 2} ${cy - 4} ${cx - 2} ${cy - 8} Z`}
                fill={color}
                opacity="0.6"
              />
            )}
            {i === 5 && (
              <>
                <path
                  d={`M${cx - 8} ${cy} L${cx} ${cy - 8} L${cx + 8} ${cy} L${cx} ${cy + 8} Z`}
                  fill="none"
                  stroke={color}
                  strokeWidth="1.5"
                />
                <line
                  x1={cx - 4}
                  y1={cy}
                  x2={cx + 4}
                  y2={cy}
                  stroke={color}
                  strokeWidth="1.5"
                />
                <line
                  x1={cx}
                  y1={cy - 4}
                  x2={cx}
                  y2={cy + 4}
                  stroke={color}
                  strokeWidth="1.5"
                />
              </>
            )}
          </g>
        );
      })}
      <g filter="url(#softShadow)" transform="translate(36,90)">
        <rect width="112" height="52" rx="12" fill="url(#cardWhite)" />
        <path d="M16 52 L26 62 L36 52" fill="url(#cardWhite)" />
        <rect x="10" y="12" width="80" height="7" rx="3.5" fill="#e2e8f0" />
        <rect x="10" y="24" width="60" height="7" rx="3.5" fill="#e2e8f0" />
        <rect x="10" y="36" width="72" height="7" rx="3.5" fill="#e2e8f0" />
        <circle cx="96" cy="24" r="8" fill="url(#cardCyan)" />
        <circle cx="96" cy="24" r="4" fill="#22d3ee" opacity="0.7" />
      </g>
      <g filter="url(#softShadow)" transform="translate(330,82)">
        <rect width="114" height="52" rx="12" fill="url(#chatOutGrad)" />
        <path d="M78 52 L88 62 L98 52" fill="url(#chatOutGrad)" />
        <rect
          x="10"
          y="12"
          width="80"
          height="7"
          rx="3.5"
          fill="white"
          opacity="0.5"
        />
        <rect
          x="10"
          y="24"
          width="60"
          height="7"
          rx="3.5"
          fill="white"
          opacity="0.4"
        />
        <rect
          x="10"
          y="36"
          width="70"
          height="7"
          rx="3.5"
          fill="white"
          opacity="0.35"
        />
      </g>
      <g filter="url(#softShadow)" transform="translate(116,280)">
        <rect width="248" height="44" rx="10" fill="url(#cardWhite)" />
        {[20, 80, 140, 200].map((x, i) => (
          <g key={i}>
            <circle
              cx={x + 4}
              cy="22"
              r="10"
              fill={["#818cf8", "#22d3ee", "#34d399", "#c5001d"][i]}
              opacity="0.8"
            />
            <circle cx={x + 4} cy="22" r="5" fill="white" opacity="0.6" />
            {i < 3 && (
              <path
                d={`M${x + 16} 22 L${x + 56} 22`}
                stroke="#cbd5e1"
                strokeWidth="1.5"
                strokeDasharray="3 2"
              />
            )}
            {i < 3 && (
              <polygon
                points={`${x + 58},19 ${x + 64},22 ${x + 58},25`}
                fill="#cbd5e1"
              />
            )}
          </g>
        ))}
      </g>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════
// ILLUSTRATION 4 — LUMINA PLUS
// ═══════════════════════════════════════════════════════
function IllustrationPlus() {
  return (
    <svg
      viewBox="0 0 480 360"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-full w-full"
    >
      <SvgDefs />
      <defs>
        <linearGradient id="moduleA" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f0ecff" />
          <stop offset="100%" stopColor="#ddd6fe" />
        </linearGradient>
        <linearGradient id="moduleB" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e0f2fe" />
          <stop offset="100%" stopColor="#bae6fd" />
        </linearGradient>
        <linearGradient id="moduleC" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#dcfce7" />
          <stop offset="100%" stopColor="#bbf7d0" />
        </linearGradient>
        <linearGradient id="moduleD" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fef9c3" />
          <stop offset="100%" stopColor="#fde68a" />
        </linearGradient>
        <radialGradient id="plusGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#818cf8" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="240" cy="296" rx="168" ry="22" fill="url(#floor)" />
      <ellipse cx="240" cy="188" rx="130" ry="100" fill="url(#plusGlow)" />
      <g filter="url(#cardShadow)" transform="translate(130,38)">
        <rect width="220" height="110" rx="14" fill="url(#cardWhite)" />
        <rect width="220" height="28" rx="14" fill="url(#cardBlue)" />
        <rect y="16" width="220" height="12" fill="url(#cardBlue)" />
        <rect
          x="10"
          y="8"
          width="80"
          height="10"
          rx="5"
          fill="#bfdbfe"
          opacity="0.7"
        />
        <circle cx="200" cy="13" r="6" fill="#c5001d" opacity="0.6" />
        <circle cx="200" cy="13" r="3" fill="#c5001d" />
        <path
          d="M12 96 L42 82 L72 86 L102 68 L132 74 L162 58 L192 64 L208 54 L208 104 L12 104 Z"
          fill="url(#lineArea)"
          opacity="0.8"
        />
        <path
          d="M12 96 L42 82 L72 86 L102 68 L132 74 L162 58 L192 64 L208 54"
          stroke="#818cf8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M12 102 L42 92 L72 96 L102 84 L132 88 L162 76 L192 82 L208 76"
          stroke="#22d3ee"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray="3 2"
        />
        <circle
          cx="162"
          cy="58"
          r="4"
          fill="white"
          stroke="#818cf8"
          strokeWidth="2"
        />
      </g>
      <g filter="url(#softShadow)" transform="translate(48,168)">
        <rect width="100" height="80" rx="12" fill="url(#moduleA)" />
        <rect
          x="10"
          y="14"
          width="36"
          height="36"
          rx="8"
          fill="#a78bfa"
          opacity="0.25"
        />
        <circle cx="28" cy="32" r="12" fill="#a78bfa" opacity="0.5" />
        <circle cx="28" cy="32" r="6" fill="#7c3aed" opacity="0.8" />
        <circle cx="28" cy="32" r="2.5" fill="white" />
        <rect x="52" y="18" width="36" height="6" rx="3" fill="#ddd6fe" />
        <rect x="52" y="28" width="28" height="6" rx="3" fill="#ede9fe" />
        <rect x="52" y="38" width="32" height="6" rx="3" fill="#ddd6fe" />
        <rect
          x="10"
          y="58"
          width="80"
          height="12"
          rx="6"
          fill="#c4b5fd"
          opacity="0.35"
        />
        <rect
          x="10"
          y="58"
          width="52"
          height="12"
          rx="6"
          fill="#7c3aed"
          opacity="0.35"
        />
      </g>
      <g filter="url(#softShadow)" transform="translate(332,168)">
        <rect width="100" height="80" rx="12" fill="url(#moduleB)" />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect
              x={10}
              y={16 + i * 22}
              width="36"
              height="14"
              rx="5"
              fill="#38bdf8"
              opacity={0.4 + i * 0.1}
            />
            {i < 2 && (
              <polygon
                points={`25,${36 + i * 22} 28,${42 + i * 22} 31,${36 + i * 22}`}
                fill="#38bdf8"
                opacity="0.5"
              />
            )}
          </g>
        ))}
        <rect
          x="56"
          y="20"
          width="32"
          height="52"
          rx="8"
          fill="#0ea5e9"
          opacity="0.12"
        />
        <rect
          x="60"
          y="56"
          width="8"
          height="12"
          rx="2"
          fill="#0ea5e9"
          opacity="0.4"
        />
        <rect
          x="70"
          y="46"
          width="8"
          height="22"
          rx="2"
          fill="#0ea5e9"
          opacity="0.6"
        />
        <rect
          x="80"
          y="38"
          width="8"
          height="30"
          rx="2"
          fill="#0ea5e9"
          opacity="0.8"
        />
      </g>
      <g filter="url(#softShadow)" transform="translate(48,265)">
        <rect width="100" height="72" rx="12" fill="url(#moduleC)" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
          const rad = (deg * Math.PI) / 180;
          return (
            <line
              key={i}
              x1={28}
              y1={36}
              x2={28 + Math.cos(rad) * 14}
              y2={36 + Math.sin(rad) * 14}
              stroke="#4ade80"
              strokeWidth={i % 2 === 0 ? 1.5 : 1}
              strokeLinecap="round"
              opacity={0.4 + i * 0.04}
            />
          );
        })}
        <circle cx="28" cy="36" r="10" fill="#4ade80" opacity="0.3" />
        <circle cx="28" cy="36" r="5" fill="#16a34a" opacity="0.8" />
        <rect x="50" y="16" width="38" height="6" rx="3" fill="#bbf7d0" />
        <rect x="50" y="27" width="30" height="6" rx="3" fill="#dcfce7" />
        <rect x="50" y="38" width="36" height="6" rx="3" fill="#bbf7d0" />
        <rect x="50" y="52" width="26" height="6" rx="3" fill="#dcfce7" />
      </g>
      <g filter="url(#softShadow)" transform="translate(332,265)">
        <rect width="100" height="72" rx="12" fill="url(#moduleD)" />
        {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(
          (deg, i) => {
            if (i % 2 !== 0) return null;
            const rad = (deg * Math.PI) / 180;
            return (
              <rect
                key={i}
                x={28 + Math.cos(rad) * 14 - 3}
                y={36 + Math.sin(rad) * 14 - 3}
                width="6"
                height="6"
                rx="1.5"
                fill="#f59e0b"
                opacity="0.5"
                transform={`rotate(${deg},${28 + Math.cos(rad) * 14},${36 + Math.sin(rad) * 14})`}
              />
            );
          }
        )}
        <circle cx="28" cy="36" r="10" fill="#fbbf24" opacity="0.3" />
        <circle cx="28" cy="36" r="6" fill="#d97706" opacity="0.7" />
        <circle cx="28" cy="36" r="2.5" fill="white" />
        <rect x="52" y="16" width="38" height="6" rx="3" fill="#fde68a" />
        <rect x="52" y="27" width="30" height="6" rx="3" fill="#fef3c7" />
        <rect x="52" y="38" width="36" height="6" rx="3" fill="#fde68a" />
        <rect x="52" y="52" width="22" height="6" rx="3" fill="#fef3c7" />
      </g>
      <path
        d="M150 208 Q190 208 210 180"
        stroke="#a78bfa"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        opacity="0.4"
        fill="none"
      />
      <path
        d="M332 208 Q292 208 270 180"
        stroke="#38bdf8"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        opacity="0.4"
        fill="none"
      />
      <path
        d="M98 280 L98 248 L100 248"
        stroke="#4ade80"
        strokeWidth="1"
        strokeDasharray="3 2"
        opacity="0.3"
        fill="none"
      />
      <path
        d="M382 280 L382 248 L380 248"
        stroke="#fbbf24"
        strokeWidth="1"
        strokeDasharray="3 2"
        opacity="0.3"
        fill="none"
      />
      <g filter="url(#softShadow)" transform="translate(384,42)">
        <rect width="58" height="42" rx="9" fill="url(#cardRed)" />
        <circle cx="29" cy="17" r="8" fill="#fca5a5" opacity="0.5" />
        <circle cx="29" cy="17" r="4" fill="#c5001d" opacity="0.8" />
        <rect
          x="8"
          y="30"
          width="42"
          height="5"
          rx="2.5"
          fill="#fca5a5"
          opacity="0.4"
        />
      </g>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════
// SLIDE STRUCTURE (text extracted to i18n)
// ═══════════════════════════════════════════════════════
const SLIDE_STRUCTURE = [
  {
    id: "core",
    bg: "from-[#f5f7ff] via-[#eef2ff] to-[#f0f4ff]",
    Illustration: IllustrationCore,
  },
  {
    id: "storage",
    bg: "from-[#f8faff] via-[#eff6ff] to-[#f0f9ff]",
    Illustration: IllustrationStorage,
  },
  {
    id: "care",
    bg: "from-[#f0fdf9] via-[#ecfdf5] to-[#f0fdfa]",
    Illustration: IllustrationCare,
  },
  {
    id: "plus",
    bg: "from-[#fefce8] via-[#fdf4ff] to-[#f5f3ff]",
    Illustration: IllustrationPlus,
  },
] as const;

// ═══════════════════════════════════════════════════════
// SLIDE PANEL
// ═══════════════════════════════════════════════════════
function SlidePanel() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(0);
  const [animating, setAnimating] = useState(false);
  const slides = SLIDE_STRUCTURE.map((slide) => ({
    ...slide,
    product: t(`login.slides.${slide.id}.product`),
    tagline: t(`login.slides.${slide.id}.tagline`),
    description: t(`login.slides.${slide.id}.description`),
    features: [
      t(`login.slides.${slide.id}.feature0`),
      t(`login.slides.${slide.id}.feature1`),
      t(`login.slides.${slide.id}.feature2`),
    ],
  }));

  const goTo = useCallback(
    (index: number) => {
      if (animating || index === current) return;
      setAnimating(true);
      setTimeout(() => {
        setCurrent(index);
        setAnimating(false);
      }, 300);
    },
    [animating, current]
  );

  const prev = () =>
    goTo((current - 1 + SLIDE_STRUCTURE.length) % SLIDE_STRUCTURE.length);
  const next = useCallback(
    () => goTo((current + 1) % SLIDE_STRUCTURE.length),
    [current, goTo]
  );

  useEffect(() => {
    const t = setInterval(next, 5500);
    return () => clearInterval(t);
  }, [next]);

  const slide = slides[current];
  const { Illustration } = slide;

  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-gradient-to-br transition-colors duration-700 select-none ${slide.bg}`}
    >
      {/* Subtle dot grid */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.035]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="dots"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="2" cy="2" r="1.5" fill="#6366f1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)" />
      </svg>

      {/* Corner glows */}
      <div className="pointer-events-none absolute top-0 right-0 h-96 w-96 bg-[radial-gradient(circle_at_top_right,rgba(129,140,248,0.1)_0%,transparent_65%)]" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-72 w-72 bg-[radial-gradient(circle_at_bottom_left,rgba(197,0,29,0.05)_0%,transparent_65%)]" />

      {/* Content */}
      <div
        className={`relative z-10 flex h-full flex-col px-10 pt-8 pb-8 transition-all duration-300 xl:px-12 ${animating ? "translate-y-2.5 opacity-0" : "translate-y-0 opacity-100"}`}
      >
        {/* Product badge */}
        <div className="mb-3 flex items-center gap-2">
          <span className="border-brand-500/[0.15] bg-brand-500/[0.08] text-brand-500 rounded-full border px-3 py-1 text-xs font-bold tracking-widest uppercase">
            {slide.product}
          </span>
        </div>

        {/* Illustration */}
        <div className="flex min-h-0 flex-1 items-center justify-center py-2">
          <div className="aspect-[480/360] w-full max-w-[390px] xl:max-w-[420px]">
            <Illustration />
          </div>
        </div>

        {/* Text content */}
        <div>
          <h2 className="mb-2 text-2xl leading-tight font-bold tracking-tight text-gray-900 xl:text-[1.65rem]">
            {slide.tagline}
          </h2>
          <p className="mb-4 max-w-sm text-sm leading-relaxed text-gray-500">
            {slide.description}
          </p>

          {/* Features */}
          <div className="mb-5 flex flex-col gap-1.5">
            {slide.features.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="border-brand-500/20 bg-brand-500/10 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border">
                  <Check className="text-brand-500 h-2.5 w-2.5" />
                </div>
                <span className="text-xs font-medium text-gray-600">{f}</span>
              </div>
            ))}
          </div>

          {/* Nav */}
          <div className="flex items-center justify-between border-t border-black/[0.06] pt-4">
            {/* Dots */}
            <div className="flex items-center gap-1.5">
              {slides.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${i === current ? "bg-brand-500 w-5" : "w-1.5 bg-black/[0.14]"}`}
                />
              ))}
            </div>

            {/* Arrows */}
            <div className="flex gap-1.5">
              <button
                onClick={prev}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.08] bg-black/[0.04] transition-all hover:bg-black/[0.09]"
              >
                <ChevronLeft className="h-4 w-4 text-gray-500" />
              </button>
              <button
                onClick={next}
                className="bg-brand-500 flex h-8 w-8 items-center justify-center rounded-full shadow-[0_2px_8px_rgba(197,0,29,0.3)] transition-all hover:bg-[#a30018]"
              >
                <ChevronRight className="h-4 w-4 text-white" />
              </button>
            </div>

            {/* Counter */}
            <span className="font-mono text-xs text-gray-300 tabular-nums">
              {String(current + 1).padStart(2, "0")} /{" "}
              {String(slides.length).padStart(2, "0")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// MAIN LOGIN PAGE
// ═══════════════════════════════════════════════════════
export function LoginPage() {
  const { t } = useTranslation();
  const [username, setUsername] = useState(
    () => localStorage.getItem(REMEMBERED_USERNAME_KEY) ?? ""
  );
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(
    () => !!localStorage.getItem(REMEMBERED_USERNAME_KEY)
  );
  const loginMutation = useLogin();
  const loginMicrosoft = useAuthStore((s) => s.loginMicrosoft);
  const loginMicrosoftSilent = useAuthStore((s) => s.loginMicrosoftSilent);
  const loginMicrosoftRedirect = useAuthStore((s) => s.loginMicrosoftRedirect);
  const [msLoading, setMsLoading] = useState(false);
  const [msAutoFailed, setMsAutoFailed] = useState(false);
  const { currentLocale, changeLocale, changing, languages } = useLanguage();
  const { settings } = useBranding();
  const appTitle = useAppTitle();
  const logoSrc = settings?.logo_url || "/lumina-logo.png";
  const [searchParams] = useState(() => new URLSearchParams(window.location.search));

  const handleMicrosoftLogin = async () => {
    setMsLoading(true);
    try {
      const authenticated = await loginMicrosoft();
      if (authenticated) return;
      toast.error(t("login.loginError"));
    } catch {
      toast.error(t("login.loginError"));
    } finally {
      setMsLoading(false);
    }
  };

  const handleSSOLogin = () => {
    if (!SSO_SERVICE_URL) return;
    const redirectUri = `${window.location.origin}/sso/callback`;
    window.location.href = `${SSO_SERVICE_URL}/auth/sso/login?redirect_uri=${encodeURIComponent(redirectUri)}&app=${encodeURIComponent(SSO_APP)}`;
  };

  useEffect(() => {
    if (!MS_CLIENT_ID) return;
    if (searchParams.get("microsoft") !== "1") return;

    // An toàn: nếu sau 20s vẫn chưa vào app / chưa rời trang (silent hoặc
    // redirect bị treo), rớt về form login thay vì kẹt loading vĩnh viễn.
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setMsLoading(false);
      setMsAutoFailed(true);
    }, 20000);

    const continueMicrosoftSso = async () => {
      setMsLoading(true);
      try {
        const authenticated = await loginMicrosoftSilent();
        if (authenticated) return;
        await loginMicrosoftRedirect();
      } catch {
        if (settled) return;
        settled = true;
        toast.error(t("login.loginError"));
        setMsLoading(false);
        setMsAutoFailed(true);
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    void continueMicrosoftSso();

    return () => window.clearTimeout(timeoutId);
  }, [loginMicrosoftRedirect, loginMicrosoftSilent, searchParams, t]);
 

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    try {
      await loginMutation.mutateAsync({ username, password });
      if (rememberMe) {
        localStorage.setItem(REMEMBERED_USERNAME_KEY, username);
      } else {
        localStorage.removeItem(REMEMBERED_USERNAME_KEY);
      }
    } catch {
      toast.error(t("login.loginError"));
    }
  };

  // Khi Core bàn giao session qua `?microsoft=1`, không bao giờ chớp form login:
  // hiện màn loading ngay từ frame đầu (guard dựa vào searchParams, có sẵn lúc
  // first render). Chỉ rớt về form khi cả silent SSO lẫn redirect đều thất bại.
  const microsoftAutoFlow = !!MS_CLIENT_ID && searchParams.get("microsoft") === "1";
  if (microsoftAutoFlow && !msAutoFailed) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-6">
          <div className="flex items-center gap-3">
            <img src={logoSrc} alt={appTitle} className="h-9 w-9 object-contain" />
            <span className="text-brand-500 text-base font-bold">{appTitle}</span>
          </div>
          <div className="border-brand-500 h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
          <p className="text-sm text-gray-500">
            {t("login.signingIn", "Đang đăng nhập với Microsoft...")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-[#fafafa]">
      {/* ── LEFT: Login Form ── */}
      <div className="relative flex w-full flex-col justify-center border-r border-[#f0f0f0] bg-white px-10 py-12 lg:w-[40%] xl:px-16">
        <div className="pointer-events-none absolute top-0 right-0 h-64 w-64 rounded-full bg-[radial-gradient(circle_at_top_right,rgba(197,0,29,0.04)_0%,transparent_70%)]" />
        <div className="absolute top-6 right-6 flex items-center gap-1 rounded-full border border-gray-200 bg-white/90 p-1 text-xs shadow-sm">
          <span className="sr-only">{t("common.language")}</span>
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => void changeLocale(lang.code)}
              disabled={changing}
              title={lang.label}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                currentLocale === lang.code
                  ? "bg-brand-500 text-white"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {lang.code.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="mx-auto w-full max-w-sm">
          {/* Logo */}
          <div className="mb-10 flex items-center gap-3">
            <img
              src={logoSrc}
              alt={appTitle}
              className="h-9 w-9 object-contain"
            />
            <span className="text-brand-500 text-base font-bold">
              {appTitle}
            </span>
          </div>

          <div className="mb-8">
            <h1 className="text-foreground mb-1.5 text-2xl font-bold tracking-tight">
              {t("login.welcomeBack")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("login.subtitle")}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label className="text-foreground mb-1.5 block text-xs font-semibold tracking-wide uppercase">
                {t("login.username")}
              </label>
              <div className="group relative">
                <User className="group-focus-within:text-brand-500 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400 transition-colors" />
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("login.usernamePlaceholder")}
                  required
                  className="focus:border-brand-500 focus:ring-brand-500/[0.08] w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pr-4 pl-10 text-sm transition-all outline-none focus:bg-white focus:ring-2"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="text-foreground mb-1.5 block text-xs font-semibold tracking-wide uppercase">
                {t("login.password")}
              </label>
              <div className="group relative">
                <Lock className="group-focus-within:text-brand-500 absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2 text-gray-400 transition-colors" />
                <PasswordInput
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("login.passwordPlaceholder")}
                  required
                  className="focus-visible:border-brand-500 focus-visible:ring-brand-500/[0.08] w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-10 text-sm focus:bg-white focus-visible:ring-2 focus-visible:ring-offset-0"
                />
              </div>
            </div>

            {/* Remember + Forgot */}
            <div className="flex items-center justify-between pt-0.5">
              <label
                className="flex cursor-pointer items-center gap-2 select-none"
                onClick={() => setRememberMe((v) => !v)}
              >
                <div
                  className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2 transition-all ${rememberMe ? "border-brand-500 bg-brand-500" : "border-gray-300 bg-transparent"}`}
                >
                  {rememberMe && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path
                        d="M1 4L3.5 6.5L9 1"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
                <span className="text-muted-foreground text-xs">
                  {t("login.rememberMe")}
                </span>
              </label>
              <button
                type="button"
                className="text-brand-500 text-xs font-medium transition-opacity hover:opacity-75"
              >
                {t("login.forgotPassword")}
              </button>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="bg-brand-500 mt-2 w-full rounded-lg py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(197,0,29,0.35)] transition-all hover:bg-[#a30018] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loginMutation.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="h-4 w-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                  {t("login.signingIn")}
                </span>
              ) : (
                t("login.signInButton", { appTitle })
              )}
            </button>
          </form>

          {(SSO_SERVICE_URL || MS_CLIENT_ID) && (
            <div className="mt-4">
              <div className="relative my-4 flex items-center gap-3">
                <div className="flex-1 border-t border-gray-200" />
                <span className="shrink-0 text-xs text-gray-400">{t("login.or")}</span>
                <div className="flex-1 border-t border-gray-200" />
              </div>
              <div className="flex flex-col gap-2">
                {MS_CLIENT_ID && (
                  <button
                    type="button"
                    onClick={handleMicrosoftLogin}
                    disabled={msLoading}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
                  >
                    {msLoading ? (
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                        <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                        <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                        <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
                      </svg>
                    )}
                    {t("login.microsoftLogin")}
                  </button>
                )}
                {SSO_SERVICE_URL && (
                  <button
                    type="button"
                    onClick={handleSSOLogin}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <Globe className="h-4 w-4" />
                    {t("login.ssoLogin")}
                  </button>
                )}
                {MS_CLIENT_ID && (
                  <p className="mt-1 text-center text-[11px] leading-relaxed text-gray-400">
                    {t("login.microsoftAutoSignInHint")}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

          {/* Divider */}
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#f0f0f0]" />
            <span className="text-muted-foreground text-xs">
              {t("login.platform")}
            </span>
            <div className="h-px flex-1 bg-[#f0f0f0]" />
          </div>

          {/* Explore hint */}
          <div className="flex items-start gap-3 rounded-xl border border-[#ffd6dc] bg-[#fff5f6] p-4">
            <div className="bg-brand-500/10 mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg">
              <Sparkles className="text-brand-500 h-3.5 w-3.5" />
            </div>
            <div>
              <p className="text-foreground mb-0.5 text-xs font-semibold">
                {t("login.exploreTitle")}
              </p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t("login.exploreDesc")}
              </p>
            </div>
          </div>

          <p className="text-muted-foreground mt-8 text-center text-xs opacity-50">
            {t("login.copyright", { appTitle })}
          </p>
      </div>

      {/* ── RIGHT: Slide Panel ── */}
      <div className="relative hidden lg:block lg:w-[60%]">
        <SlidePanel />
      </div>
    </div>
  );
}
