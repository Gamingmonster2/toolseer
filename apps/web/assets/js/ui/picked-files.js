/**
 * picked-files.js — receive a file the Android side secured, without a callback.
 *
 * The device log settled this: the picker returns the file, and the in-memory callback
 * that should carry it to the page is gone because Android delivered the result to a
 * fresh activity. So the native side copies every picked file into the app's own folder
 * and announces it by name. This module rebuilds it into a File and hands it to whatever
 * tool is open, which is the same mechanism the chip test proved works inside the app.
 *
 * It also gives the app a door that does not depend on the system picker at all: the
 * files in the app's own folder can be listed and chosen directly.
 */
import { isNativeApp } from './native-save.js';

function bridge() {
  try { return (typeof window !== 'undefined' && window.ToolSeerNative) || null; } catch { return null; }
}

function base64ToFile(name, base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const type = /\.pdf$/i.test(name) ? 'application/pdf'
    : /\.(png)$/i.test(name) ? 'image/png'
      : /\.(xlsx?|docx?|pptx?|zip)$/i.test(name) ? 'application/octet-stream'
        : 'image/jpeg';
  return new File([bytes], name, { type });
}

/** Push one or more files into the open tool, exactly as if they had been dragged in. */
export function feedFiles(files) {
  const input = document.querySelector('input[type=file]');
  if (!input || !files.length) return false;
  try {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

/** Rebuild the named files and hand them to the tool. */
export async function collectPicked(names) {
  const api = bridge();
  if (!api) return false;
  const files = [];
  for (const name of names) {
    if (!name) continue;
    const base64 = api.readMyFile(name);
    if (typeof base64 === 'string' && base64.startsWith('error:')) continue;
    files.push(base64ToFile(name, base64));
  }
  return feedFiles(files);
}

/** Files the app has made or kept, newest first. */
export function listMyFiles() {
  const api = bridge();
  if (!api || typeof api.listMyFiles !== 'function') return [];
  try {
    const parsed = JSON.parse(api.listMyFiles());
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function myFilesPath() {
  const api = bridge();
  return api && typeof api.myFilesPath === 'function' ? api.myFilesPath() : '';
}

export function deleteMyFile(name) {
  const api = bridge();
  return Boolean(api && typeof api.deleteMyFile === 'function' && api.deleteMyFile(name));
}

export function openMyFile(name) {
  const api = bridge();
  return Boolean(api && typeof api.openMyFile === 'function' && api.openMyFile(name));
}

/* The native side announces a picked file by name. Nothing else needs wiring. */
if (isNativeApp()) {
  window.onToolSeerPicked = async (csv) => {
    const names = String(csv || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    const delivered = await collectPicked(names);
    if (!delivered) {
      /* No tool open (the hub, or a page with no input): keep them visible instead. */
      window.dispatchEvent(new CustomEvent('toolseer:picked', { detail: { names } }));
    }
  };
}
