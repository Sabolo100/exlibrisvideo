/**
 * Ex Libris Video UI kit – import everything from "@/components/ui".
 * See README.md in this folder for one usage example per component.
 */
export { cn, type ClassValue } from './cn';

// actions
export { Button, buttonClasses, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export { IconButton, type IconButtonProps, type IconButtonSize } from './IconButton';

// surfaces & labels
export { Card, CardHeader, CardBody, CardFooter, type CardProps, type CardVariant, type CardHeaderProps } from './Card';
export { Badge, TONE_CLASSES, type BadgeProps, type BadgeTone } from './Badge';
export { Chip, type ChipProps } from './Chip';
export { Kbd, type KbdProps } from './Kbd';
export { VisuallyHidden, type VisuallyHiddenProps } from './VisuallyHidden';
export { Stat, type StatProps } from './Stat';
export { EmptyState, EmptyShelfIllustration, type EmptyStateProps } from './EmptyState';

// form controls
export { Field, useField, useFieldControlProps, type FieldProps } from './Field';
export { Input, CONTROL_BASE, CONTROL_SIZES, type InputProps, type ControlSize } from './Input';
export { Textarea, type TextareaProps } from './Textarea';
export { Select, type SelectProps, type SelectOption } from './Select';
export { Checkbox, type CheckboxProps } from './Checkbox';
export { Switch, type SwitchProps } from './Switch';
export { SegmentedControl, type SegmentedControlProps, type SegmentedOption } from './SegmentedControl';
export { StarRating, type StarRatingProps } from './StarRating';
export { CopyField, copyToClipboard, type CopyFieldProps } from './CopyField';

// overlays
export { Dialog, type DialogProps, type DialogSize } from './Dialog';
export { Drawer, type DrawerProps, type DrawerSize } from './Drawer';
export { Popover, type PopoverProps } from './Popover';
export {
  DropdownMenu,
  type DropdownMenuProps,
  type DropdownMenuItem,
  type DropdownActionItem,
  type DropdownCheckboxItem,
  type DropdownRadioItem,
} from './DropdownMenu';
export { Tooltip, type TooltipProps } from './Tooltip';
export { Portal } from './Portal';

// navigation
export { Tabs, TabsList, TabsTrigger, TabsContent, type TabsProps, type TabsTriggerProps } from './Tabs';

// feedback
export { ProgressBar, type ProgressBarProps, type ProgressTone } from './ProgressBar';
export { ProgressRing, type ProgressRingProps } from './ProgressRing';
export { Spinner, type SpinnerProps, type SpinnerSize } from './Spinner';
export { Skeleton, SkeletonText, type SkeletonProps } from './Skeleton';
export { ToastProvider, useToast, type ToastOptions, type ToastApi, type ToastTone } from './Toast';

// media
export { QrCode, qrSvgString, downloadQrPng, type QrCodeProps } from './QrCode';

// app chrome
export { ThemeToggle, type ThemeToggleProps } from './ThemeToggle';
export { LanguageSwitch, type LanguageSwitchProps } from './LanguageSwitch';
export { useTheme, setThemePreference, readThemePreference, type ThemePreference, type ResolvedTheme } from './theme';

// hooks & helpers
export {
  useMediaQuery,
  useMounted,
  useControllableState,
  useFocusTrap,
  useScrollLock,
  useLayer,
  useEscape,
  useFloating,
  getTabbables,
} from './hooks';
export { computeFloatingPosition, type Side, type Align } from './floating';
