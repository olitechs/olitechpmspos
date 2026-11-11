import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Loader2, Network, Printer,
  RefreshCw, Usb, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { testPrint } from '@/services/printService';
import { savePrinterPrintSettings } from '@/services/printerPrintSettings';
import {
  PRINTER_ROLES,
  buildPrinterSetup,
  canContinue,
  describeAgentFailure,
  describeTestOutcome,
  detectAgent,
  listAvailablePrinters,
  manualNetworkPrinter,
  nextStep,
  previousStep,
  roleById,
  savePrinterSetup,
} from '@/services/printerSetupCore';

const STEP_TITLES = {
  agent: 'Find the print agent',
  printer: 'Choose a printer',
  role: 'What is it used for?',
  settings: 'Name and paper',
  test: 'Print a test page',
  done: 'Printer ready',
};
const CONTROL_STEPS = ['agent', 'printer', 'role', 'settings', 'test'];

export default function PrinterSetupWizard({ open, propertyId, agentUrl = 'http://127.0.0.1:8631', onClose, onSaved }) {
  const [step, setStep] = useState('agent');
  const [agent, setAgent] = useState(null);
  const [checking, setChecking] = useState(false);
  const [agentError, setAgentError] = useState('');
  const [printers, setPrinters] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [selection, setSelection] = useState(null);
  const [roleId, setRoleId] = useState('receipt');
  const [name, setName] = useState('');
  const [paperWidth, setPaperWidth] = useState('80mm');
  const [manual, setManual] = useState({ host: '', port: '9100' });
  const [manualError, setManualError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedPrinter, setSavedPrinter] = useState(null);
  const [testAttempted, setTestAttempted] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const reset = useCallback(() => {
    setStep('agent');
    setAgent(null);
    setAgentError('');
    setPrinters([]);
    setWarnings([]);
    setSelection(null);
    setRoleId('receipt');
    setName('');
    setPaperWidth('80mm');
    setManual({ host: '', port: '9100' });
    setManualError('');
    setSaveError('');
    setSavedPrinter(null);
    setTestAttempted(false);
    setTestResult(null);
  }, []);

  const loadPrinters = useCallback(async (baseUrl) => {
    setLoadingPrinters(true);
    setManualError('');
    try {
      const result = await listAvailablePrinters(baseUrl);
      setPrinters(result.printers || []);
      setWarnings(result.warnings || []);
    } catch (error) {
      setPrinters([]);
      setWarnings([error?.message || 'Printers could not be listed.']);
    } finally {
      setLoadingPrinters(false);
    }
  }, []);

  const checkAgent = useCallback(async () => {
    setChecking(true);
    setAgentError('');
    try {
      const result = await detectAgent(agentUrl);
      setAgent(result);
      if (result.ok) {
        setStep('printer');
        await loadPrinters(result.baseUrl);
      } else {
        setAgentError(describeAgentFailure(result));
      }
    } finally {
      setChecking(false);
    }
  }, [agentUrl, loadPrinters]);

  useEffect(() => {
    if (!open) return;
    reset();
    checkAgent();
  }, [open, reset, checkAgent]);

  if (!open) return null;

  const choosePrinter = (printer) => {
    setSelection(printer);
    setName(printer.name);
    setStep('role');
  };

  const addManualPrinter = () => {
    const result = manualNetworkPrinter(manual);
    if (!result.ok) {
      setManualError(result.message);
      return;
    }
    setManualError('');
    choosePrinter(result.printer);
  };

  const runTest = async (printer) => {
    setTesting(true);
    setTestAttempted(true);
    setSaveError('');
    try {
      const result = await testPrint(printer, propertyId);
      setTestResult(describeTestOutcome(result));
    } catch (error) {
      setTestResult(describeTestOutcome({ ok: false, friendlyError: error?.message }));
    } finally {
      setTesting(false);
    }
  };

  const saveAndTest = async () => {
    if (!propertyId) {
      setSaveError('This login is not linked to a property, so the printer cannot be saved.');
      return;
    }
    const built = buildPrinterSetup({ printer: selection, roleId, name, paperWidth, agentUrl });
    if (!built.ok) {
      setSaveError(built.message);
      return;
    }

    // Coming back to this step after a failed test must retry the test, never
    // insert a second copy of the printer.
    if (savedPrinter?.id) {
      setStep('test');
      await runTest(savedPrinter);
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const saved = await savePrinterSetup({ client: supabase, propertyId, setup: built, agentUrl });
      if (!saved.ok) throw new Error(saved.message);

      const printer = saved.printer;
      setSavedPrinter(printer);
      savePrinterPrintSettings(printer.id, { paperWidth: built.payload.paper_width });

      setStep('test');
      await runTest(printer);
    } catch (error) {
      setSaveError(error?.message || 'The printer could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const finish = () => {
    onSaved?.();
    onClose?.();
  };

  const goNext = () => {
    if (step === 'settings') {
      saveAndTest();
      return;
    }
    if (step === 'test') {
      onSaved?.();
      setStep('done');
      return;
    }
    setStep(nextStep(step));
  };

  const stepIndex = CONTROL_STEPS.indexOf(step);
  const canGoNext = canContinue(step, { agent, selection, roleId, name, testAttempted });
  const role = roleById(roleId);

  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center overflow-y-auto bg-foreground/55 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="printer-wizard-title" className="my-6 w-full max-w-2xl overflow-hidden rounded-3xl bg-surface shadow-2xl">
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">
              <Printer size={13}/> Printer setup
            </div>
            <h2 id="printer-wizard-title" className="mt-1 text-lg font-black text-foreground">{STEP_TITLES[step]}</h2>
            <p className="mt-1 text-xs text-muted-foreground">Five short steps. No technical knowledge needed.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close printer setup" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><X size={18}/></button>
        </div>

        {step !== 'done' && (
          <div className="flex gap-1.5 border-b border-border bg-secondary/60 px-5 py-3">
            {CONTROL_STEPS.map((control, index) => (
              <div key={control} className="flex flex-1 flex-col gap-1">
                <div className={`h-1.5 rounded-full ${index <= stepIndex ? 'bg-primary' : 'bg-border'}`}/>
                <span className={`truncate text-[10px] font-bold uppercase tracking-wide ${index === stepIndex ? 'text-foreground' : 'text-muted-foreground'}`}>{STEP_TITLES[control]}</span>
              </div>
            ))}
          </div>
        )}

        <div className="max-h-[62vh] space-y-4 overflow-y-auto p-5">
          {agentError && <Notice error text={agentError}/>}
          {saveError && <Notice error text={saveError}/>}

          {step === 'agent' && (
            <div className="space-y-4">
              <div className={`rounded-2xl border p-4 ${agent?.ok ? 'border-[var(--success)] bg-[var(--success-soft)]' : 'border-border bg-secondary'}`}>
                <div className="flex items-start gap-3">
                  <div className={`rounded-xl p-2.5 ${agent?.ok ? 'bg-surface text-[var(--success-text)]' : 'bg-surface text-muted-foreground'}`}>
                    {checking || !agent ? <Loader2 size={16} className="animate-spin"/> : agent.ok ? <CheckCircle2 size={16}/> : <AlertCircle size={16}/>}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-black text-foreground">
                      {checking || !agent ? 'Looking for the print agent…' : agent.ok ? 'Print agent found' : 'Print agent not found'}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {checking || !agent
                        ? 'This usually takes a second.'
                        : agent.ok
                          ? `Version ${agent.version || 'unknown'} · ${agent.mode === 'service' ? 'running as a Windows service' : 'manual session'}. It keeps printing when this browser closes.`
                          : agentError}
                    </div>
                  </div>
                </div>
              </div>
              {(!agent?.ok) && (
                <ol className="space-y-2 rounded-2xl border border-border bg-surface p-4 text-sm text-foreground">
                  <li>1. Ask your installer to run the OliTechs Print Agent installer on this computer.</li>
                  <li>2. Wait until it says the service is running.</li>
                  <li>3. Press <b>Try again</b> below — you do not need to restart the browser.</li>
                </ol>
              )}
            </div>
          )}

          {step === 'printer' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">These are the printers this computer can actually reach. Choose the one you want to use.</p>
              {warnings.map((warning) => <Notice key={warning} text={warning}/>)}

              {loadingPrinters ? (
                <div className="flex items-center gap-2 rounded-2xl border border-border bg-secondary p-5 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin"/>Looking for printers…</div>
              ) : printers.length ? (
                <div className="space-y-2">
                  {printers.map((printer) => (
                    <button
                      key={printer.id}
                      type="button"
                      onClick={() => choosePrinter(printer)}
                      className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition ${selection?.id === printer.id ? 'border-[var(--primary)] bg-primary-soft' : 'border-border bg-surface hover:bg-secondary'}`}
                    >
                      <div className="rounded-xl bg-secondary p-2.5 text-foreground">{printer.source === 'windows' ? <Usb size={16}/> : <Network size={16}/>}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-black text-foreground">{printer.name}</div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">{printer.detail}</div>
                        <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{printer.source === 'windows' ? 'Installed in Windows' : 'Network printer'}</div>
                      </div>
                      <ArrowRight size={16} className="mt-1 shrink-0 text-muted-foreground"/>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                  <div className="font-black text-foreground">No printers were found automatically</div>
                  <p className="mt-1">That is normal for a printer with a fixed address. Enter its address below, or check that the printer is switched on and connected.</p>
                </div>
              )}

              <div className="rounded-2xl border border-border bg-secondary/60 p-4">
                <div className="text-xs font-black uppercase tracking-wide text-muted-foreground">My printer is not listed</div>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    aria-label="Printer IP address"
                    value={manual.host}
                    onChange={(event) => setManual({ ...manual, host: event.target.value })}
                    placeholder="192.168.1.50"
                    className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none focus:border-[var(--primary)]"
                  />
                  <select
                    aria-label="Printer TCP port"
                    value={manual.port}
                    onChange={(event) => setManual({ ...manual, port: event.target.value })}
                    className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
                  >
                    <option value="9100">Port 9100</option>
                    <option value="9101">Port 9101</option>
                    <option value="9102">Port 9102</option>
                  </select>
                  <button type="button" onClick={addManualPrinter} className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-bold text-foreground hover:bg-secondary">Use this address</button>
                </div>
                {manualError && <div className="mt-2 text-xs font-semibold text-[var(--danger-text)]">{manualError}</div>}
              </div>

              <button type="button" onClick={() => loadPrinters(agent?.baseUrl || agentUrl)} disabled={loadingPrinters} className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2 text-xs font-bold text-foreground hover:bg-secondary disabled:opacity-50">
                <RefreshCw size={13} className={loadingPrinters ? 'animate-spin' : ''}/> Look again
              </button>
            </div>
          )}

          {step === 'role' && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Pick what this printer should print. You can add more printers later for other stations.</p>
              {PRINTER_ROLES.map((roleOption) => (
                <button
                  key={roleOption.id}
                  type="button"
                  onClick={() => setRoleId(roleOption.id)}
                  className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition ${roleId === roleOption.id ? 'border-[var(--primary)] bg-primary-soft' : 'border-border bg-surface hover:bg-secondary'}`}
                >
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${roleId === roleOption.id ? 'border-[var(--primary)] bg-primary' : 'border-border'}`}>
                    {roleId === roleOption.id && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground"/>}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-black text-foreground">{roleOption.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{roleOption.description}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {step === 'settings' && (
            <div className="space-y-4">
              <label className="block text-xs font-black uppercase tracking-wide text-muted-foreground">
                Printer name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Reception receipt"
                  className="mt-1.5 w-full rounded-xl border border-border px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none focus:border-[var(--primary)]"
                />
                <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-muted-foreground">This is the name staff will see when choosing where to print.</span>
              </label>

              <div>
                <div className="text-xs font-black uppercase tracking-wide text-muted-foreground">Paper size</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {['80mm', '58mm'].map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setPaperWidth(size)}
                      className={`rounded-xl border p-3 text-left ${paperWidth === size ? 'border-[var(--primary)] bg-primary-soft' : 'border-border bg-surface hover:bg-secondary'}`}
                    >
                      <div className="text-sm font-black text-foreground">{size === '80mm' ? '80 mm (standard)' : '58 mm (small)'}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{size === '80mm' ? 'Most counter receipt printers' : 'Handheld and compact printers'}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-secondary/60 p-4 text-xs leading-5 text-muted-foreground">
                <div className="font-black uppercase tracking-wide text-foreground">What happens when you continue</div>
                <p className="mt-1">The printer is saved for this property and assigned to {role?.label?.toLowerCase() || 'its role'}. A real test page is then sent, and the printer is only shown as Connected if the printer accepts it.</p>
              </div>
            </div>
          )}

          {step === 'test' && (
            <div className="space-y-4">
              <div className={`rounded-2xl border p-4 ${testResult?.ok ? 'border-[var(--success)] bg-[var(--success-soft)]' : testResult ? 'border-[var(--danger)] bg-[var(--danger-soft)]' : 'border-border bg-secondary'}`}>
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-surface p-2.5">
                    {testing ? <Loader2 size={16} className="animate-spin text-muted-foreground"/> : testResult?.ok ? <CheckCircle2 size={16} className="text-[var(--success-text)]"/> : <AlertCircle size={16} className="text-[var(--danger-text)]"/>}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-black text-foreground">{testing ? 'Sending a test page…' : testResult?.title || 'Waiting for the test'}</div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">{testing ? 'This can take a few seconds.' : testResult?.detail}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-surface p-4 text-xs leading-5 text-muted-foreground">
                <div className="font-black uppercase tracking-wide text-foreground">If nothing printed</div>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li>Check the printer is switched on and has paper.</li>
                  <li>Check the cable or that it is on the same Wi-Fi or network.</li>
                  <li>Press <b>Test again</b>. The printer is already saved, so nothing is lost.</li>
                </ul>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--success-soft)] text-[var(--success-text)]"><CheckCircle2 size={28}/></div>
              <div>
                <h3 className="text-lg font-black text-foreground">{savedPrinter?.name || name} is set up</h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  It is assigned to {role?.label?.toLowerCase() || 'printing'} on {paperWidth} paper. You can change any of this later under Settings → Printers.
                </p>
              </div>
              {testResult && !testResult.ok && (
                <Notice error text={`The printer was saved, but the test did not succeed: ${testResult.detail}`}/>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border bg-secondary p-5 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setStep(previousStep(step))}
            disabled={step === 'agent' || step === 'done' || saving}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-bold text-foreground disabled:opacity-40"
          >
            <ArrowLeft size={15}/> Back
          </button>

          <div className="flex flex-col gap-2 sm:flex-row">
            {step === 'agent' && !agent?.ok && (
              <button type="button" onClick={checkAgent} disabled={checking} className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-bold text-foreground disabled:opacity-50">
                {checking ? 'Checking…' : 'Try again'}
              </button>
            )}
            {step === 'test' && !testResult?.ok && (
              <button type="button" onClick={() => savedPrinter && runTest(savedPrinter)} disabled={testing} className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-bold text-foreground disabled:opacity-50">
                Test again
              </button>
            )}
            {step !== 'done' ? (
              <button
                type="button"
                onClick={goNext}
                disabled={!canGoNext || saving || testing}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-primary-foreground disabled:opacity-50"
              >
                {saving ? 'Saving…' : step === 'settings' ? 'Save and print test page' : step === 'test' ? 'Finish setup' : 'Continue'}
                {!saving && <ArrowRight size={15}/>}
              </button>
            ) : (
              <button type="button" onClick={finish} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-primary-foreground">Done</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Notice({ error = false, text }) {
  return (
    <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold ${error ? 'border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger-text)]' : 'border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning-text)]'}`}>
      <AlertCircle size={16} className="mt-0.5 shrink-0"/>
      <span>{text}</span>
    </div>
  );
}
