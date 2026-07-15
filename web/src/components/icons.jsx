import { useId } from 'react'

function Icon({
  title,
  size = 24,
  className,
  children,
  role: _role,
  'aria-hidden': _ariaHidden,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...svgProps
}) {
  const titleId = useId()
  const labelledBy = [ariaLabelledBy, title ? titleId : null].filter(Boolean).join(' ') || undefined
  const hasAccessibleName = Boolean(title || ariaLabel || ariaLabelledBy)
  const accessibilityProps = hasAccessibleName
    ? {
        role: 'img',
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
        ...(labelledBy ? { 'aria-labelledby': labelledBy } : {}),
      }
    : { 'aria-hidden': true }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...svgProps}
      {...accessibilityProps}
    >
      {title ? <title id={titleId}>{title}</title> : null}
      {children}
    </svg>
  )
}

export function MenuIcon(props) {
  return <Icon {...props}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>
}

export function PlusIcon(props) {
  return <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>
}

export function ChevronIcon(props) {
  return <Icon {...props}><path d="m8 10 4 4 4-4" /></Icon>
}

export function MoreIcon(props) {
  return <Icon {...props}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></Icon>
}

export function SettingsIcon(props) {
  return <Icon {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.55v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-1.5-1H2.5V10h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.56 4.2l.06.06A1.7 1.7 0 0 0 8.5 4.6a1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 18.9 9a1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1 1Z" /></Icon>
}

export function PhoneIcon(props) {
  return <Icon {...props}><path d="M7.2 3.8 9.5 7a1 1 0 0 1-.12 1.3L8 9.65a14 14 0 0 0 6.35 6.35l1.35-1.38a1 1 0 0 1 1.3-.12l3.2 2.3a1 1 0 0 1 .35 1.2l-.75 2a2 2 0 0 1-1.87 1.3C9.5 21.3 2.7 14.5 2.7 6.07A2 2 0 0 1 4 4.2l2-.75a1 1 0 0 1 1.2.35Z" /></Icon>
}

export function AiVoiceIcon(props) {
  return <Icon {...props}><path d="M5 14v-4M9 17V7M13 20V4M17 16V8M21 14v-4" /></Icon>
}

export function MicrophoneIcon(props) {
  return <Icon {...props}><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" /></Icon>
}

export function SendIcon(props) {
  return <Icon {...props}><path d="m3 11 18-8-8 18-2-8-8-2ZM11 13 21 3" /></Icon>
}

export function CloseIcon(props) {
  return <Icon {...props}><path d="m6 6 12 12M18 6 6 18" /></Icon>
}

export function EditIcon(props) {
  return <Icon {...props}><path d="M13.5 6.5 17.5 10.5M4 20l4.5-1 10-10a2.83 2.83 0 0 0-4-4l-10 10L4 20Z" /></Icon>
}

export function TrashIcon(props) {
  return <Icon {...props}><path d="M4 7h16M9 7V4h6v3M6.5 7l1 14h9l1-14M10 11v6M14 11v6" /></Icon>
}

export function ArrowUpIcon(props) {
  return <Icon {...props}><path d="M12 19V5M6 11l6-6 6 6" /></Icon>
}

export function ArrowDownIcon(props) {
  return <Icon {...props}><path d="M12 5v14M18 13l-6 6-6-6" /></Icon>
}

export function AttachmentIcon(props) {
  return <Icon {...props}><path d="m20.5 11.5-8.8 8.8a5 5 0 0 1-7.1-7.1l9.2-9.2a3.5 3.5 0 0 1 5 5l-9.2 9.2a2 2 0 1 1-2.8-2.8l8.5-8.5" /></Icon>
}

export function PlayIcon(props) {
  return <Icon {...props}><path d="m8 5 11 7-11 7V5Z" /></Icon>
}

export function StopIcon(props) {
  return <Icon {...props}><rect x="6" y="6" width="12" height="12" rx="1" /></Icon>
}

export function SpeakerIcon(props) {
  return <Icon {...props}><path d="M5 9H2v6h3l5 4V5L5 9ZM14 9a4 4 0 0 1 0 6M17 6a8 8 0 0 1 0 12" /></Icon>
}

export function LogoutIcon(props) {
  return <Icon {...props}><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M14 8l4 4-4 4M8 12h10" /></Icon>
}
