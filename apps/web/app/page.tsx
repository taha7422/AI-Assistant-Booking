'use client';

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';

type Service = { id: string; name: string; durationMinutes: number };
type Appointment = { id: string; serviceId: string; serviceName: string; startsAt: string; endsAt: string; status: 'booked' | 'cancelled'; createdVia: 'chat' | 'form' };
type ChatMeta = { action?: 'ask_more' | 'suggest_slots' | 'booked' | 'modified' | 'show_form' | 'error'; quickReplies?: string[]; appointment?: Appointment };
type ChatMessage = { id?: string; role: 'user' | 'assistant'; content: string; metadata?: ChatMeta };
type Session = { id: string; title: string; lastMessage?: string | null; updatedAt: string };

function getApiUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:4000/api';
  }
  if (typeof window !== 'undefined' && window.location.hostname === '127.0.0.1') {
    return 'http://127.0.0.1:4000/api';
  }
  if (process.env.NODE_ENV === 'production') throw new Error('NEXT_PUBLIC_API_URL must be set to the deployed API URL ending in /api.');
  return 'http://127.0.0.1:4000/api';
}

async function request(path: string, token?: string, init: RequestInit = {}) {
  const response = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  const payload = await response.json().catch(() => ({})) as { data?: unknown; error?: { message?: string } | string };
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : payload.error?.message;
    throw new Error(message || `Request failed (${response.status}).`);
  }
  return payload.data as any;
}
function readToken() { return sessionStorage.getItem('booking-token') || localStorage.getItem('booking-token') || ''; }
function saveSession(token: string, name: string, remember: boolean) {
  sessionStorage.removeItem('booking-token'); localStorage.removeItem('booking-token');
  sessionStorage.removeItem('booking-name'); localStorage.removeItem('booking-name');
  (remember ? localStorage : sessionStorage).setItem('booking-token', token);
  (remember ? localStorage : sessionStorage).setItem('booking-name', name);
}

export default function Home() {
  const [token, setToken] = useState('');
  const [userName, setUserName] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [terms, setTerms] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [activeTab, setActiveTab] = useState<'chat' | 'appointments'>('chat');
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState('');
  const [timeZone, setTimeZone] = useState('Europe/London');
  const [slots, setSlots] = useState<string[]>([]);
  const [slot, setSlot] = useState('');
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const isResizing = useRef(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const sendingMessage = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.min(Math.max(e.clientX - 24, 180), 420);
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const loadAccount = useCallback(async (accessToken: string, preferredSessionId?: string) => {
    const [serviceRows, appointmentRows, sessionRows, business] = await Promise.all([
      request('/appointments/services', accessToken),
      request('/appointments', accessToken),
      request('/chat/sessions', accessToken),
      request('/business', accessToken),
    ]) as [Service[], Appointment[], Session[], { timeZone: string }];
    setServices(serviceRows); setAppointments(appointmentRows); setSessions(sessionRows); setTimeZone(business.timeZone);
    setServiceId((old) => old || serviceRows[0]?.id || '');
    let chosen = sessionRows.find((item) => item.id === preferredSessionId) || sessionRows[0];
    let sessionData: { id: string; title: string; messages: ChatMessage[] };
    if (chosen) sessionData = await request(`/chat/sessions/${chosen.id}`, accessToken);
    else sessionData = await request('/chat/sessions', accessToken, { method: 'POST', body: JSON.stringify({}) });
    setSessionId(sessionData.id);
    sessionStorage.setItem('booking-chat-session', sessionData.id);
    setChat(sessionData.messages || []);
    if (!chosen) setSessions(await request('/chat/sessions', accessToken));
  }, []);

  useEffect(() => {
    const accessToken = readToken();
    if (!accessToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await request('/auth/me', accessToken);
        if (cancelled) return;
        setToken(accessToken); setUserName(result.user.name);
        await loadAccount(accessToken, sessionStorage.getItem('booking-chat-session') || undefined);
      } catch {
        sessionStorage.removeItem('booking-token'); localStorage.removeItem('booking-token');
        sessionStorage.removeItem('booking-name'); localStorage.removeItem('booking-name');
        setToken(''); setError('Your session ended. Please sign in again.');
      }
    })();
    return () => { cancelled = true; };
  }, [loadAccount]);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [chat]);

  async function authenticate(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await request(`/auth/${authMode}`, undefined, {
        method: 'POST',
        body: JSON.stringify({ ...(authMode === 'register' ? { name } : {}), email, password }),
      });
      saveSession(result.token, result.user.name, remember);
      setToken(result.token); setUserName(result.user.name);
      await loadAccount(result.token);
      setNotice(authMode === 'register' ? `Welcome, ${result.user.name}.` : 'You are signed in.');
    } catch (exception) { setError((exception as Error).message); }
    finally { setBusy(false); }
  }

  async function chooseSession(id: string) {
    setError(''); setBusy(true);
    try {
      const result = await request(`/chat/sessions/${id}`, token);
      setSessionId(result.id); sessionStorage.setItem('booking-chat-session', result.id); setChat(result.messages || []);
    } catch (exception) { setError((exception as Error).message); }
    finally { setBusy(false); }
  }

  const hasUserMessages = chat.some((m) => m.role === 'user');

  async function newChat() {
    if (!hasUserMessages && sessionId && sessions.length > 0) {
      setNotice('You are already in a new chat. Complete or send a message in this chat first.');
      return;
    }
    setError(''); setBusy(true); setNotice('');
    try {
      const result = await request('/chat/sessions', token, { method: 'POST', body: JSON.stringify({}) });
      setSessionId(result.id); sessionStorage.setItem('booking-chat-session', result.id); setChat(result.messages || []);
      setSessions(await request('/chat/sessions', token)); setActiveTab('chat');
    } catch (exception) { setError((exception as Error).message); }
    finally { setBusy(false); }
  }

  async function sendContent(raw: string) {
    const content = raw.trim();
    if (!content || !sessionId || busy || sendingMessage.current) return;
    sendingMessage.current = true;
    setError(''); setText(''); setBusy(true);
    setChat((current) => [...current, { role: 'user', content }]);
    try {
      const result = await request(`/chat/sessions/${sessionId}/messages`, token, { method: 'POST', body: JSON.stringify({ content }) });
      setChat((current) => [...current, result.message as ChatMessage]);
      if (result.action === 'booked' || result.action === 'modified') {
        setNotice(result.action === 'modified' ? 'Your appointment was updated.' : 'Your appointment is confirmed.');
        setAppointments(await request('/appointments', token));
      }
      setSessions(await request('/chat/sessions', token));
    } catch (exception) {
      setChat((current) => [...current, { role: 'assistant', content: `${(exception as Error).message} You can continue with the manual booking form.` }]);
    } finally { sendingMessage.current = false; setBusy(false); }
  }

  async function sendMessage(event: FormEvent) { event.preventDefault(); await sendContent(text); }
  function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendContent(text); }
  }

  async function loadSlots() {
    setError(''); setSlot(''); setSlots([]);
    try {
      const result = await request(`/appointments/availability?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`, token);
      setSlots(result.slots); setTimeZone(result.timeZone);
      if (!result.slots.length) setNotice('No available times for that date. Choose another weekday within the next 30 days.');
      else setNotice('Select one of the available times.');
    } catch (exception) { setError((exception as Error).message); }
  }

  async function book(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await request('/appointments', token, { method: 'POST', body: JSON.stringify({ serviceId, startsAt: slot }) });
      setNotice('Appointment booked.'); setSlot(''); setSlots([]);
      setAppointments(await request('/appointments', token));
    } catch (exception) { setError((exception as Error).message); }
    finally { setBusy(false); }
  }

  async function cancel(id: string) {
    setBusy(true); setError('');
    try {
      await request(`/appointments/${id}/cancel`, token, { method: 'PATCH' });
      setNotice('Appointment cancelled.'); setAppointments(await request('/appointments', token));
    } catch (exception) { setError((exception as Error).message); }
    finally { setBusy(false); }
  }

  function signOut() {
    sessionStorage.removeItem('booking-token'); localStorage.removeItem('booking-token');
    sessionStorage.removeItem('booking-name'); localStorage.removeItem('booking-name');
    sessionStorage.removeItem('booking-chat-session');
    setToken(''); setUserName(''); setAppointments([]); setSessions([]); setChat([]); setSessionId('');
    setError(''); setNotice('');
  }

  if (!token) return (
    <main className="auth-layout">
      <aside className="brand-panel">
        <a className="brand brand-light" href="#"><span className="brand-mark">A</span> AI Assistant Booking</a>
        <div className="brand-copy">
          <p className="eyebrow eyebrow-light">APPOINTMENTS, MADE SIMPLE</p>
          <h1>Book with a conversation.</h1>
          <p>Find a time that works, confirm your appointment, and keep everything in one place.</p>
          <ul><li>Natural-language booking assistance</li><li>Availability checks before confirmation</li><li>Manage or cancel your bookings</li></ul>
        </div>
        <p className="brand-footer">Private, clear, and built around your schedule.</p>
      </aside>
      <section className="auth-area">
        <div className="auth-card">
          <p className="eyebrow">{authMode === 'register' ? 'CREATE YOUR ACCOUNT' : 'YOUR BOOKINGS, IN ONE PLACE'}</p>
          <h2>{authMode === 'register' ? 'Start booking' : 'Welcome back'}</h2>
          <p className="muted">{authMode === 'register' ? 'Create an account to book and manage appointments.' : 'Sign in to manage your appointments.'}</p>
          <form onSubmit={authenticate} className="stack">
            {authMode === 'register' && <label>Full name<input required minLength={2} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>}
            <label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" autoFocus={authMode === 'login'} /></label>
            <label>Password<div className="password-wrap"><input required type={showPassword ? 'text' : 'password'} minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} /><button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'Hide' : 'Show'}</button></div><span className="field-hint">At least 8 characters, including a letter and a number.</span></label>
            {authMode === 'register' ? <label className="check-row"><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} required />I agree to the Terms and Privacy Policy.</label> : <label className="check-row"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />Keep me signed in on this device</label>}
            <button className="primary" disabled={busy || (authMode === 'register' && !terms)}>{busy ? 'Please wait…' : authMode === 'register' ? 'Create account' : 'Sign in'}</button>
          </form>
          {error && <p className="form-error" role="alert">{error}</p>}
          <p className="auth-switch">{authMode === 'register' ? 'Already have an account?' : 'New to AI Assistant Booking?'} <button className="text-button" onClick={() => { setAuthMode(authMode === 'register' ? 'login' : 'register'); setError(''); }}> {authMode === 'register' ? 'Sign in' : 'Create an account'}</button></p>
        </div>
      </section>
    </main>
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-mark">A</span> AI Assistant Booking</a>
        <nav className="top-nav" aria-label="Main navigation">
          <button className={activeTab === 'chat' ? 'nav-link active' : 'nav-link'} onClick={() => setActiveTab('chat')}>Chat</button>
          <button className={activeTab === 'appointments' ? 'nav-link active' : 'nav-link'} onClick={() => setActiveTab('appointments')}>Appointments</button>
        </nav>
        <div className="account-menu"><span className="avatar" aria-hidden="true">{userName.slice(0, 1).toUpperCase()}</span><span className="account-name">{userName}</span><button className="text-button" onClick={signOut}>Sign out</button></div>
      </header>
      {(notice || error) && <div className={error ? 'alert alert-error' : 'alert'} role={error ? 'alert' : 'status'}>{error || notice}<button aria-label="Dismiss message" onClick={() => { setError(''); setNotice(''); }}>×</button></div>}

      {activeTab === 'chat' ? <div className="workspace">
        <aside className="session-sidebar" style={{ width: `${sidebarWidth}px` }}>
          <button
            className="primary new-chat"
            onClick={newChat}
            disabled={busy || (!hasUserMessages && sessions.length > 0)}
            title={!hasUserMessages && sessions.length > 0 ? 'Send a message in this chat before starting another' : 'Start a new chat'}
          >
            ＋ New chat
          </button>
          <p className="sidebar-label">RECENT CHATS</p>
          <div className="session-list">{sessions.map((session) => <button key={session.id} className={session.id === sessionId ? 'session-button selected' : 'session-button'} onClick={() => void chooseSession(session.id)}><strong>{session.title}</strong><span>{session.lastMessage || 'No messages yet'}</span></button>)}</div>
        </aside>
        <div
          className="sidebar-dragger"
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize chat list"
          onMouseDown={(e) => {
            e.preventDefault();
            isResizing.current = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
        >
          <div className="dragger-handle" />
        </div>
        <section className="chat-panel">
          <div className="panel-heading"><span className="ai-avatar">AI</span><div><h1>Booking assistant</h1><p className="online">● Available</p></div></div>
          <div className="chat-messages" aria-live="polite">{chat.map((message, index) => <article key={message.id || `${message.role}-${index}`} className={`message-row ${message.role}`}><span className="message-avatar">{message.role === 'assistant' ? 'AI' : userName.slice(0, 1).toUpperCase()}</span><div className={`message-bubble ${message.role}`}>{message.content}{message.metadata?.action === 'booked' && <div className="booking-success">Appointment booked</div>}{message.metadata?.action === 'modified' && <div className="booking-success">Appointment updated</div>}{message.metadata?.action === 'show_form' && <button className="text-button fallback-link" onClick={() => document.getElementById('manual-booking')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Open the manual booking form</button>}{message.metadata?.quickReplies?.length ? <div className="quick-replies">{message.metadata.quickReplies.map((reply) => <button key={reply} className="chip" disabled={busy} onClick={() => void sendContent(reply)}>{reply}</button>)}</div> : null}</div></article>)}{busy && <div className="message-row assistant"><span className="message-avatar">AI</span><div className="message-bubble assistant typing">Checking…</div></div>}<div ref={chatEnd} /></div>
          <form className="chat-composer" onSubmit={sendMessage}><textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={sendOnEnter} placeholder="Describe the appointment you need…" maxLength={500} aria-label="Your message" /><button className="primary send-button" disabled={busy || !text.trim()}>Send</button></form>
        </section>
        <aside id="manual-booking" className="booking-panel">
          <div className="eyebrow">MANUAL FALLBACK</div><h2>Book an appointment</h2><p className="muted">You can book here even if the assistant is unavailable.</p>
          <form className="stack" onSubmit={book}>
            <label>Service<select required value={serviceId} onChange={(event) => { setServiceId(event.target.value); setSlots([]); setSlot(''); }}><option value="">Select a service</option>{services.map((service) => <option value={service.id} key={service.id}>{service.name} · {service.durationMinutes} min</option>)}</select></label>
            <label>Date<input required type="date" value={date} onChange={(event) => { setDate(event.target.value); setSlots([]); setSlot(''); }} /></label>
            <button type="button" className="secondary" onClick={() => void loadSlots()} disabled={!serviceId || !date || busy}>Show available times</button>
            {slots.length > 0 && <label>Available time<select required value={slot} onChange={(event) => setSlot(event.target.value)}><option value="">Choose a time</option>{slots.map((value) => <option value={value} key={value}>{new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone })}</option>)}</select><span className="field-hint">Business timezone: {timeZone}</span></label>}
            {!slots.length && <p className="field-hint">Monday–Friday, 09:00–17:00. Book 1 hour to 30 days ahead.</p>}
            <button className="primary" disabled={busy || !slot}>{busy ? 'Saving…' : 'Confirm appointment'}</button>
          </form>
        </aside>
      </div> : <section className="appointments-panel">
        <div className="panel-title"><div><div className="eyebrow">YOUR BOOKINGS</div><h1>Appointments</h1><p className="muted">View or cancel appointments booked from chat or the form.</p></div><span className="count">{appointments.filter((item) => item.status === 'booked').length} active</span></div>
        {appointments.length === 0 ? <div className="empty-state"><h2>No appointments yet</h2><p className="muted">Start a chat or use the manual form to book your first appointment.</p><button className="primary" onClick={() => setActiveTab('chat')}>Book an appointment</button></div> : <div className="appointment-list">{appointments.map((appointment) => <article className="appointment-card" key={appointment.id}><div><strong>{appointment.serviceName}</strong><p className="muted">{new Date(appointment.startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short', timeZone })} · {timeZone}</p><span className={`status ${appointment.status}`}>{appointment.status}</span><span className="field-hint">Booked via {appointment.createdVia === 'chat' ? 'assistant' : 'form'}</span></div>{appointment.status === 'booked' && <button className="cancel-button" disabled={busy} onClick={() => void cancel(appointment.id)}>Cancel appointment</button>}</article>)}</div>}
      </section>}
    </main>
  );
}
