'use client';

import { useState, useEffect } from 'react';
import { Shield, Save, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getConfiguredWebhookUrl } from '@/lib/api';
import { CUIBadge } from '@/components/CUIBadge';
import type { AppSettings } from '@/lib/types';

const SETTINGS_KEY = 'crn-pm-settings';

function loadSettings(): AppSettings {
  if (typeof window === 'undefined') {
    return {
      webhookBaseUrl: process.env.NEXT_PUBLIC_N8N_BASE_URL ?? 'https://n8n.colvin.run',
      useTestWebhook: process.env.NEXT_PUBLIC_USE_TEST_WEBHOOK === 'true',
      cuiTeamIds: [],
    };
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as AppSettings;
  } catch { /* ignore */ }
  return {
    webhookBaseUrl: process.env.NEXT_PUBLIC_N8N_BASE_URL ?? 'https://n8n.colvin.run',
    useTestWebhook: process.env.NEXT_PUBLIC_USE_TEST_WEBHOOK === 'true',
    cuiTeamIds: [],
  };
}

function saveSettings(settings: AppSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:gap-6">
      <div className="sm:w-56 sm:shrink-0">
        <div className="text-sm font-medium text-slate-200">{label}</div>
        {description && <div className="mt-0.5 text-xs text-slate-500">{description}</div>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function SettingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/40">
      <div className="border-b border-slate-700/50 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
      </div>
      <div className="divide-y divide-slate-700/40 px-4">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [saved, setSaved] = useState(false);
  const activeWebhookUrl = getConfiguredWebhookUrl();

  useEffect(() => { setSettings(loadSettings()); }, []);

  function handleSave() {
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleReset() {
    const defaults: AppSettings = {
      webhookBaseUrl: process.env.NEXT_PUBLIC_N8N_BASE_URL ?? 'https://n8n.colvin.run',
      useTestWebhook: process.env.NEXT_PUBLIC_USE_TEST_WEBHOOK === 'true',
      cuiTeamIds: [],
    };
    setSettings(defaults);
    saveSettings(defaults);
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-white">Settings</h1>
        <p className="text-sm text-slate-500">Dashboard configuration and integrations</p>
      </div>

      <SettingSection title="Data Source — n8n Webhook">
        <SettingRow label="Base URL" description="n8n instance hosting the portfolio webhook">
          <input
            type="url"
            value={settings.webhookBaseUrl}
            onChange={(e) => setSettings((prev) => ({ ...prev, webhookBaseUrl: e.target.value }))}
            className={cn(
              'w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2',
              'text-sm text-slate-200 placeholder:text-slate-600',
              'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'
            )}
            placeholder="https://n8n.colvin.run"
          />
          <div className="mt-1.5 text-xs text-slate-600">
            Active URL: <code className="text-slate-500">{activeWebhookUrl}</code>
          </div>
        </SettingRow>

        <SettingRow label="Use Test Webhook" description="Toggles between /webhook-test/portfolio and /webhook/portfolio">
          <label className="flex cursor-pointer items-center gap-3">
            <div className="relative">
              <input
                type="checkbox"
                className="sr-only"
                checked={settings.useTestWebhook}
                onChange={(e) => setSettings((prev) => ({ ...prev, useTestWebhook: e.target.checked }))}
              />
              <div className={cn('h-5 w-9 rounded-full transition-colors', settings.useTestWebhook ? 'bg-blue-600' : 'bg-slate-700')} />
              <div className={cn('absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                settings.useTestWebhook ? 'translate-x-4' : 'translate-x-0')} />
            </div>
            <span className="text-sm text-slate-400">
              {settings.useTestWebhook ? 'Using test webhook' : 'Using production webhook'}
            </span>
          </label>
        </SettingRow>
      </SettingSection>

      <SettingSection title="Controlled Unclassified Information (CUI)">
        <SettingRow label="CUI Programs" description="Mark teams whose programs contain CUI. A warning badge will appear on their cards.">
          <div className="text-xs text-slate-600 flex items-center gap-2">
            <CUIBadge compact />
            CUI badges can be applied per-team. Team IDs will populate here after first data load.
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection title="Future Integrations">
        <SettingRow label="Slack" description="Slack workspace integration for comms panel">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Shield className="h-3 w-3" />Not yet configured — coming in a future release
          </div>
        </SettingRow>
        <SettingRow label="Microsoft Teams" description="Teams channel integration">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Shield className="h-3 w-3" />Not yet configured — coming in a future release
          </div>
        </SettingRow>
        <SettingRow label="Calendar" description="Outlook / Google Calendar for schedule panel">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Shield className="h-3 w-3" />Not yet configured — coming in a future release
          </div>
        </SettingRow>
      </SettingSection>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className={cn(
            'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
            saved
              ? 'border border-green-700 bg-green-900/40 text-green-400'
              : 'border border-blue-700 bg-blue-900/40 text-blue-400 hover:bg-blue-900/60'
          )}
        >
          <Save className="h-3.5 w-3.5" />
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
        <button
          onClick={handleReset}
          className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
        >
          <RotateCcw className="h-3.5 w-3.5" />Reset to Defaults
        </button>
      </div>
    </div>
  );
}
