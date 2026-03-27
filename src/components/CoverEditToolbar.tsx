import type { ReactNode } from 'react';

type CoverEditToolbarProps = {
  ariaLabel: string;
  className?: string;
  children: ReactNode;
};

type CoverToolbarButtonProps = {
  ariaLabel: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

type CoverToolbarGroupProps = {
  children: ReactNode;
};

export function CoverEditToolbar({ ariaLabel, className = '', children }: CoverEditToolbarProps) {
  const classes = className ? `cover-edit-toolbar ${className}` : 'cover-edit-toolbar';
  return (
    <div aria-label={ariaLabel} className={classes} role="toolbar">
      {children}
    </div>
  );
}

export function CoverToolbarGroup({ children }: CoverToolbarGroupProps) {
  return <div className="daw-toolbar-group">{children}</div>;
}

export function CoverToolbarDivider() {
  return <span aria-hidden="true" className="daw-toolbar-divider" />;
}

export function CoverToolbarButton({
  ariaLabel,
  title,
  onClick,
  disabled = false,
  className = 'daw-tool-button',
  children,
}: CoverToolbarButtonProps) {
  return (
    <button
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}
