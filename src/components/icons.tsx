import React from 'react'

type IconProps = React.SVGProps<SVGSVGElement>

/**
 * Small inline SVG icons used by the application shell.
 * They inherit colour from the surrounding text (currentColor),
 * so the active / hover colours are controlled entirely by CSS.
 */
const BaseIcon: React.FC<IconProps> = ({ children, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    {children}
  </svg>
)

export const HomeIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  </BaseIcon>
)

export const LibraryIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M4 4h4v16H4z" />
    <path d="M10 4h4v16h-4z" />
    <path d="m16.2 5.6 3.8 1-3.6 13.5-3.8-1z" />
  </BaseIcon>
)

export const TopicsIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </BaseIcon>
)

export const ConnectIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <circle cx="6" cy="7" r="2.2" />
    <circle cx="18" cy="7" r="2.2" />
    <circle cx="12" cy="18" r="2.2" />
    <path d="M8.2 7h7.6M7.2 8.8l3.8 7.4M16.8 8.8l-3.8 7.4" />
  </BaseIcon>
)

export const MenuIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </BaseIcon>
)

export const CloseIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </BaseIcon>
)
