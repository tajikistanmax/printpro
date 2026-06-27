'use client';

import { useEffect, useState } from 'react';
import { API_BASE, DEFAULT_COMPANY_ID } from '@/lib/config';

interface UploadedFile {
  url: string;
  name: string;
}

export default function PublicOrderPage() {
  const cid = DEFAULT_COMPANY_ID;
  const [services, setServices] = useState<any[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/public/services?companyId=${cid}`)
      .then((r) => r.json())
      .then(setServices)
      .catch(() => {});
  }, [cid]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/public/upload`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error('Не удалось загрузить файл');
      const data = await res.json();
      setFiles((f) => [...f, { url: data.url, name: data.name }]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!phone) {
      setError('Укажите телефон для связи');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/public/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: cid,
          clientPhone: phone,
          clientName: name || undefined,
          serviceId: serviceId || undefined,
          description: description || undefined,
          files,
        }),
      });
      if (!res.ok) throw new Error('Не удалось отправить заказ');
      const data = await res.json();
      setDone(data.orderNumber);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
          <div className="mb-3 text-5xl">✅</div>
          <h1 className="mb-2 text-2xl font-bold text-slate-800">
            Заказ принят!
          </h1>
          <p className="text-slate-600">
            Ваш номер заказа: <span className="font-bold">№{done}</span>
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Мы свяжемся с вами по телефону для уточнения деталей и стоимости.
          </p>
          <button
            onClick={() => {
              setDone(null);
              setFiles([]);
              setDescription('');
            }}
            className="mt-6 rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700"
          >
            Новый заказ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-600 to-indigo-800 p-4">
      <div className="mx-auto max-w-xl">
        <div className="py-8 text-center text-white">
          <h1 className="text-3xl font-bold">PrintPro · DushanbePrint</h1>
          <p className="mt-1 text-indigo-200">
            Закажите печать онлайн — загрузите макет, мы всё сделаем
          </p>
          <a
            href="/cabinet"
            className="mt-3 inline-block rounded-lg bg-white/15 px-4 py-1.5 text-sm text-white hover:bg-white/25"
          >
            👤 Мои заказы (личный кабинет)
          </a>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-2xl bg-white p-6 shadow-2xl"
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              Услуга
            </label>
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">— выберите услугу —</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">
                Ваше имя
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Имя"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">
                Телефон *
              </label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="+992 ..."
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              Что нужно сделать
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Например: визитки 100 шт, глянцевая бумага"
            />
          </div>

          {/* Загрузка файла */}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              Ваш макет (файл)
            </label>
            <label className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-4 py-6 text-slate-500 hover:border-indigo-400 hover:text-indigo-600">
              <input type="file" onChange={onUpload} className="hidden" />
              {uploading ? 'Загрузка…' : '📎 Нажмите, чтобы прикрепить файл'}
            </label>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700"
                  >
                    <span>📄 {f.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setFiles((arr) => arr.filter((_, idx) => idx !== i))
                      }
                      className="text-rose-500"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <button
            disabled={busy}
            className="w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Отправка…' : 'Отправить заказ'}
          </button>
        </form>

        <p className="py-6 text-center text-sm text-indigo-200">
          © PrintPro — система управления типографией
        </p>
      </div>
    </div>
  );
}
