export function DesktopLogo(props: { class?: string }) {
  return (
    <svg
      data-component="desktop-logo"
      aria-hidden="true"
      class={props.class}
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <clipPath id="ocd-c">
          <rect width="1024" height="1024" rx="224" />
        </clipPath>

        <linearGradient id="ocd-bg" x1="140" y1="30" x2="880" y2="1000" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#1C2130" />
          <stop offset=".45" stop-color="#0F121A" />
          <stop offset="1" stop-color="#06070B" />
        </linearGradient>
        <radialGradient id="ocd-warm" cx=".22" cy=".14" r=".8">
          <stop offset="0" stop-color="#FF6A00" stop-opacity=".26" />
          <stop offset="1" stop-color="#FF6A00" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="ocd-cool" cx=".84" cy=".9" r=".7">
          <stop offset="0" stop-color="#2F7BFF" stop-opacity=".20" />
          <stop offset="1" stop-color="#2F7BFF" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="ocd-vig" cx=".5" cy=".45" r=".78">
          <stop offset=".5" stop-color="#000" stop-opacity="0" />
          <stop offset="1" stop-color="#000" stop-opacity=".55" />
        </radialGradient>
        <linearGradient id="ocd-gloss" x1="0" y1="0" x2="0" y2="540" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#fff" stop-opacity=".07" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="ocd-edge" x1="0" y1="0" x2="0" y2="1024" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#fff" stop-opacity=".24" />
          <stop offset=".5" stop-color="#fff" stop-opacity=".05" />
          <stop offset="1" stop-color="#fff" stop-opacity=".12" />
        </linearGradient>

        <linearGradient id="ocd-ice" x1="331" y1="360" x2="560" y2="680" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#FFFFFF" />
          <stop offset="1" stop-color="#93A2C4" />
        </linearGradient>
        <linearGradient id="ocd-fire" x1="574" y1="649" x2="700" y2="649" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#FF6A00" />
          <stop offset="1" stop-color="#FFC24D" />
        </linearGradient>
        <linearGradient id="ocd-arc" x1="217.6" y1="342" x2="806.4" y2="342" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#2FE0FF" />
          <stop offset=".5" stop-color="#FF7A18" />
          <stop offset="1" stop-color="#FFC24D" />
        </linearGradient>

        <pattern id="ocd-dots" width="38" height="38" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.6" fill="#FFFFFF" fill-opacity=".055" />
        </pattern>

        <filter id="ocd-soft" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="10" result="b" />
          <feComponentTransfer in="b" result="bb">
            <feFuncA type="linear" slope=".55" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode in="bb" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="ocd-hot" x="-90%" y="-90%" width="280%" height="280%">
          <feGaussianBlur stdDeviation="16" result="b" />
          <feComponentTransfer in="b" result="bb">
            <feFuncA type="linear" slope=".9" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode in="bb" />
            <feMergeNode in="bb" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g clip-path="url(#ocd-c)">
        <rect width="1024" height="1024" fill="url(#ocd-bg)" />
        <rect width="1024" height="1024" fill="url(#ocd-warm)" />
        <rect width="1024" height="1024" fill="url(#ocd-cool)" />
        <rect width="1024" height="1024" fill="url(#ocd-dots)" />
        <rect width="1024" height="1024" fill="url(#ocd-vig)" />
        <path
          d="M0 224A224 224 0 0 1 224 0H800A224 224 0 0 1 1024 224V430C800 548 224 548 0 430Z"
          fill="url(#ocd-gloss)"
        />

        <g fill="#FFFFFF" fill-opacity=".15">
          <circle cx="120" cy="120" r="11" />
          <circle cx="164" cy="120" r="11" />
          <circle cx="208" cy="120" r="11" />
        </g>

        <circle cx="512" cy="512" r="215" fill="#FF7A18" opacity=".10" filter="url(#ocd-hot)" />

        <circle cx="512" cy="512" r="340" fill="none" stroke="#FFFFFF" stroke-opacity=".07" stroke-width="2" />
        <path
          d="M217.6 342A340 340 0 0 1 806.4 342"
          fill="none"
          stroke="url(#ocd-arc)"
          stroke-width="11"
          stroke-linecap="round"
          filter="url(#ocd-hot)"
        />
        <g filter="url(#ocd-hot)">
          <circle cx="217.6" cy="342" r="17" fill="#2FE0FF" />
          <circle cx="806.4" cy="342" r="17" fill="#FF8A1E" />
        </g>
        <circle cx="217.6" cy="342" r="6.5" fill="#06070B" />
        <circle cx="806.4" cy="342" r="6.5" fill="#06070B" />
        <circle cx="806" cy="682" r="7" fill="#FFFFFF" fill-opacity=".22" />
        <circle cx="218" cy="682" r="7" fill="#FFFFFF" fill-opacity=".22" />

        <g fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M331 375 511 512 331 649" stroke="url(#ocd-ice)" stroke-width="50" filter="url(#ocd-soft)" />
          <path d="M584 649H694" stroke="url(#ocd-fire)" stroke-width="50" filter="url(#ocd-hot)" />
        </g>

        <g fill="url(#ocd-fire)" filter="url(#ocd-hot)">
          <path d="M676 286Q686 330 730 340Q686 350 676 394Q666 350 622 340Q666 330 676 286Z" />
          <path d="M720 681Q723 700 744 705Q723 710 720 729Q717 710 696 705Q717 700 720 681Z" />
        </g>

        <rect x="4" y="4" width="1016" height="1016" rx="220" fill="none" stroke="url(#ocd-edge)" stroke-width="3" />
      </g>
    </svg>
  )
}
