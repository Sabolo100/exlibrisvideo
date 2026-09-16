'use client';

import { BookOpen, Library, Menu, Plus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { useEscape, useFocusTrap, useLayer, useScrollLock } from '@/components/ui/hooks';
import { IconButton } from '@/components/ui/IconButton';
import { LanguageSwitch } from '@/components/ui/LanguageSwitch';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useI18n } from '@/i18n/client';
import { Logo } from './Logo';

const DEMO_ID = process.env.NEXT_PUBLIC_DEMO_COLLECTION_ID;

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
}

/** Focuses <main> for the skip link (layout.tsx's <main> has no id). */
function skipToContent(e: React.MouseEvent<HTMLAnchorElement>) {
  const main = document.querySelector('main');
  if (!main) return;
  e.preventDefault();
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  main.focus();
  main.scrollIntoView();
}

/** Sticky translucent paper header: logo, navigation, language switch, theme toggle, mobile menu. */
export function SiteHeader() {
  const { t } = useI18n();
  const pathname = usePathname() ?? '/';
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const firstMenuLinkRef = useRef<HTMLAnchorElement>(null);
  const layer = useLayer(menuOpen);
  useEscape(menuOpen, layer, () => setMenuOpen(false));
  // trap inside the header (toggle button + menu panel); opened without focus (touch) → first menu link
  useFocusTrap(headerRef, menuOpen, layer, { initialFocus: firstMenuLinkRef });
  useScrollLock(menuOpen);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // close the mobile menu when the viewport grows past the breakpoint
  useEffect(() => {
    if (!menuOpen) return;
    const mql = window.matchMedia('(min-width: 768px)');
    const onChange = () => mql.matches && setMenuOpen(false);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [menuOpen]);

  const items: NavItem[] = [
    { href: '/my', label: t('common.nav.my'), icon: <Library aria-hidden="true" />, active: pathname.startsWith('/my') },
    ...(DEMO_ID
      ? [
          {
            href: `/${DEMO_ID}`,
            label: t('common.nav.demo'),
            icon: <BookOpen aria-hidden="true" />,
            active: pathname === `/${DEMO_ID}`,
          },
        ]
      : []),
  ];

  return (
    <>
    <header ref={headerRef} className="sticky top-0 z-40 border-b border-line/70 bg-bg/80 backdrop-blur-md backdrop-saturate-150 supports-[not(backdrop-filter:blur(0))]:bg-bg">
      <a
        href="#main"
        onClick={skipToContent}
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-ink focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        {t('common.aria.skipToContent')}
      </a>
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:h-16 sm:px-6">
        <Logo label={t('common.aria.home')} className="-ml-1 px-1" />

        <nav aria-label={t('common.aria.mainNav')} className="ml-6 hidden items-center gap-1 md:flex">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                'relative inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors [&_svg]:size-4',
                item.active ? 'text-ink' : 'text-muted hover:bg-surface-2/70 hover:text-ink',
              )}
            >
              {item.icon}
              {item.label}
              {item.active ? (
                <span aria-hidden="true" className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-accent sm:-bottom-[17px]" />
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <Button href="/#upload" variant="primary" size="sm" leftIcon={<Plus aria-hidden="true" />} className="max-sm:hidden">
            {t('common.nav.new')}
          </Button>
          <div className="hidden items-center gap-1.5 md:flex">
            <LanguageSwitch />
            <ThemeToggle />
          </div>
          <IconButton
            aria-label={menuOpen ? t('common.aria.closeMenu') : t('common.aria.openMenu')}
            aria-expanded={menuOpen}
            aria-controls="exl-mobile-menu"
            icon={menuOpen ? <X /> : <Menu />}
            onClick={() => setMenuOpen((v) => !v)}
            className="md:hidden"
          />
        </div>
      </div>

      <AnimatePresence>
        {menuOpen ? (
            <motion.div
              key="panel"
              id="exl-mobile-menu"
              aria-label={t('common.menu.title')}
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.14 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              className="absolute inset-x-0 top-full z-40 border-b border-line bg-surface shadow-lift md:hidden"
            >
              <nav aria-label={t('common.aria.mainNav')} className="mx-auto flex max-w-6xl flex-col px-4 pt-3 pb-2 sm:px-6">
                <Link
                  ref={firstMenuLinkRef}
                  href="/#upload"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-3 font-display text-lg font-semibold text-primary hover:bg-surface-2 [&_svg]:size-5"
                >
                  <Plus aria-hidden="true" />
                  {t('common.nav.new')}
                </Link>
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={item.active ? 'page' : undefined}
                    onClick={() => setMenuOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-3 font-display text-lg hover:bg-surface-2 [&_svg]:size-5 [&_svg]:text-muted',
                      item.active ? 'bg-surface-2 font-semibold text-ink' : 'text-ink',
                    )}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mx-auto flex max-w-6xl flex-col gap-4 border-t border-line/70 px-7 pt-4 pb-5 sm:px-9">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <span className="text-sm text-muted">{t('common.lang.switch')}</span>
                  <LanguageSwitch size="md" labels="long" />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <span className="text-sm text-muted">{t('common.theme.label')}</span>
                  <ThemeToggle variant="segmented" size="sm" />
                </div>
              </div>
            </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
    {/* outside <header>: its backdrop-filter would make it the containing block of fixed children */}
    <AnimatePresence>
      {menuOpen ? (
        <motion.div
          key="overlay"
          aria-hidden="true"
          className="fixed inset-x-0 top-14 bottom-0 z-30 bg-[rgb(20_14_8/0.35)] sm:top-16 md:hidden dark:bg-[rgb(0_0_0/0.55)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
    </AnimatePresence>
    </>
  );
}
