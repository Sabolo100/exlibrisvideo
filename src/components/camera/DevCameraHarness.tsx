'use client';

/**
 * Dev-only harness for the recorder (/dev-camera). Query parameters:
 *   ?max=<seconds>                       per-clip limit
 *   ?simulate=denied|in_use|not_found|insecure|unsupported   break the camera before opening
 * Results are exposed on `window.__cameraHarness` for browser automation.
 */
import { Camera } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { formatBytes } from '@/components/upload/format';
import { isInAppRecordingSupported } from './camera';
import { CameraRecorder } from './CameraRecorder';

export interface CameraHarnessState {
  opens: number;
  closes: number;
  dones: number;
  /** files of the last onDone */
  files: File[];
}

declare global {
  interface Window {
    __cameraHarness?: CameraHarnessState;
  }
}

const SIMULATIONS = ['denied', 'in_use', 'not_found', 'insecure', 'unsupported'] as const;
type Simulation = (typeof SIMULATIONS)[number];

const ERROR_NAME: Record<'denied' | 'in_use' | 'not_found', string> = {
  denied: 'NotAllowedError',
  in_use: 'NotReadableError',
  not_found: 'NotFoundError',
};

function simulate(kind: Simulation) {
  if (kind === 'insecure') {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => false });
    return;
  }
  const media = navigator.mediaDevices;
  if (!media) return;
  if (kind === 'unsupported') {
    Object.defineProperty(media, 'getUserMedia', { configurable: true, value: undefined });
    return;
  }
  const name = ERROR_NAME[kind];
  Object.defineProperty(media, 'getUserMedia', {
    configurable: true,
    value: () => Promise.reject(new DOMException(`simulated ${name}`, name)),
  });
}

export function DevCameraHarness() {
  const [open, setOpen] = useState(false);
  const [maxDurationSec, setMaxDurationSec] = useState(180);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const max = Number(params.get('max'));
    if (Number.isFinite(max) && max > 0) setMaxDurationSec(max);
    const sim = params.get('simulate');
    if (sim && (SIMULATIONS as readonly string[]).includes(sim)) {
      simulate(sim as Simulation);
      setSimulation(sim as Simulation);
    }
    setSupported(isInAppRecordingSupported());
    window.__cameraHarness = { opens: 0, closes: 0, dones: 0, files: [] };
  }, []);

  const push = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${line}`, ...l].slice(0, 20));
  const harness = () => (window.__cameraHarness ??= { opens: 0, closes: 0, dones: 0, files: [] });

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <Card>
        <CardHeader
          icon={<Camera />}
          title="Camera recorder – dev harness"
          description={`in-app recording supported: ${supported === null ? '…' : String(supported)} · max ${maxDurationSec} s${simulation ? ` · simulate ${simulation}` : ''}`}
        />
        <CardBody className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="lg"
            data-testid="open-recorder"
            onClick={() => {
              harness().opens += 1;
              push('open');
              setOpen(true);
            }}
          >
            Open recorder
          </Button>
          {SIMULATIONS.map((s) => (
            <Button key={s} href={`/dev-camera?simulate=${s}`} external size="sm" variant="ghost">
              {s}
            </Button>
          ))}
          <Button href="/dev-camera" external size="sm" variant="ghost">
            reset
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`onDone files (${files.length})`} />
        <CardBody>
          <ul className="space-y-1 text-sm" data-testid="result-files">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="font-mono">
                {f.name} · {f.type || '(no type)'} · {formatBytes(f.size, 'en')}
              </li>
            ))}
          </ul>
          <ul className="mt-3 space-y-0.5 text-xs text-muted">
            {log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <CameraRecorder
        open={open}
        maxDurationSec={maxDurationSec}
        onClose={() => {
          harness().closes += 1;
          push('onClose');
          setOpen(false);
        }}
        onDone={(recorded) => {
          const h = harness();
          h.dones += 1;
          h.files = recorded;
          push(`onDone: ${recorded.length} file(s)`);
          setFiles(recorded);
          setOpen(false);
        }}
      />
    </div>
  );
}
