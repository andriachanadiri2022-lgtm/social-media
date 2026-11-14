import { useCallback, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from './supabase.js';

const initials = (name = 'Friend') =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'F';

const relativeTime = (date) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function Avatar({ name, small = false }) {
  return <span className={`avatar${small ? ' avatar-small' : ''}`}>{initials(name)}</span>;
}

function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState('signup');
  const [authForm, setAuthForm] = useState({ email: '', password: '', name: '' });
  const [authNotice, setAuthNotice] = useState('');
  const [authError, setAuthError] = useState('');
  const [posts, setPosts] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [comments, setComments] = useState({});
  const [draft, setDraft] = useState('');
  const [commentDrafts, setCommentDrafts] = useState({});
  const [profileForm, setProfileForm] = useState({ full_name: '', username: '', bio: '' });
  const [editingProfile, setEditingProfile] = useState(false);
  const [activePage, setActivePage] = useState('home');
  const [feedLoading, setFeedLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const user = session?.user ?? null;
  const ownProfile = user ? profiles[user.id] : null;
  const displayName = ownProfile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Friend';

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return undefined;
    }

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) setAuthError(sessionError.message);
      setSession(data?.session ?? null);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadFeed = useCallback(async () => {
    if (!supabase) return;
    setFeedLoading(true);
    setError('');

    const { data: postRows, error: postError } = await supabase
      .from('posts')
      .select('id, author_id, content, created_at')
      .order('created_at', { ascending: false });

    if (postError) {
      setError(postError.message);
      setFeedLoading(false);
      return;
    }

    const postIds = (postRows ?? []).map((post) => post.id);
    const commentResult = postIds.length
      ? await supabase.from('comments').select('id, post_id, author_id, content, created_at').in('post_id', postIds).order('created_at')
      : { data: [], error: null };
    const authorIds = [...new Set([
      ...(postRows ?? []).map((post) => post.author_id),
      ...(commentResult.data ?? []).map((comment) => comment.author_id),
    ])];
    const profileResult = authorIds.length
      ? await supabase.from('profiles').select('id, username, full_name, bio').in('id', authorIds)
      : { data: [], error: null };

    const loadError = profileResult.error || commentResult.error;
    if (loadError) setError(loadError.message);
    const nextProfiles = Object.fromEntries((profileResult.data ?? []).map((profile) => [profile.id, profile]));
    if (user && !nextProfiles[user.id]) {
      const { data: myProfile, error: myProfileError } = await supabase
        .from('profiles')
        .select('id, username, full_name, bio')
        .eq('id', user.id)
        .maybeSingle();
      if (myProfileError) setError(myProfileError.message);
      if (myProfile) nextProfiles[user.id] = myProfile;
    }

    const nextComments = {};
    for (const comment of commentResult.data ?? []) {
      nextComments[comment.post_id] ??= [];
      nextComments[comment.post_id].push(comment);
    }

    setProfiles(nextProfiles);
    setComments(nextComments);
    setPosts(postRows ?? []);
    setFeedLoading(false);
  }, [user]);

  useEffect(() => {
    if (user) loadFeed();
    else {
      setPosts([]);
      setComments({});
      setProfiles({});
    }
  }, [user, loadFeed]);

  useEffect(() => {
    if (!ownProfile) return;
    setProfileForm({
      full_name: ownProfile.full_name ?? '',
      username: ownProfile.username ?? '',
      bio: ownProfile.bio ?? '',
    });
  }, [ownProfile]);

  const profilePosts = useMemo(
    () => posts.filter((post) => post.author_id === user?.id),
    [posts, user],
  );

  async function handleAuth(event) {
    event.preventDefault();
    setAuthError('');
    setAuthNotice('');
    setBusy(true);

    const result = authMode === 'signup'
      ? await supabase.auth.signUp({
        email: authForm.email.trim(),
        password: authForm.password,
        options: {
          data: { full_name: authForm.name.trim() },
          emailRedirectTo: import.meta.env.VITE_APP_URL
            || new URL(window.location.pathname, window.location.origin).toString(),
        },
      })
      : await supabase.auth.signInWithPassword({
        email: authForm.email.trim(),
        password: authForm.password,
      });

    setBusy(false);
    if (result.error) {
      setAuthError(result.error.message);
      return;
    }
    if (authMode === 'signup' && !result.data.session) {
      setAuthNotice('Check your email to confirm your account, then come back and sign in.');
      return;
    }
    setSession(result.data.session);
  }

  async function signOut() {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
  }

  async function createPost(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !user) return;
    setBusy(true);
    setError('');
    const { error: postError } = await supabase.from('posts').insert({
      author_id: user.id,
      content,
    });
    setBusy(false);
    if (postError) {
      setError(postError.message);
      return;
    }
    setDraft('');
    setNotice('Your post is out in the world.');
    await loadFeed();
  }

  async function createComment(event, postId) {
    event.preventDefault();
    const content = (commentDrafts[postId] ?? '').trim();
    if (!content || !user) return;
    setBusy(true);
    setError('');
    const { error: commentError } = await supabase.from('comments').insert({
      post_id: postId,
      author_id: user.id,
      content,
    });
    setBusy(false);
    if (commentError) {
      setError(commentError.message);
      return;
    }
    setCommentDrafts((current) => ({ ...current, [postId]: '' }));
    await loadFeed();
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!user) return;
    const username = profileForm.username.trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      setError('Username must be 3–24 characters and use only letters, numbers, or underscores.');
      return;
    }
    setBusy(true);
    setError('');
    const { data, error: profileError } = await supabase
      .from('profiles')
      .update({
        full_name: profileForm.full_name.trim(),
        username,
        bio: profileForm.bio.trim(),
      })
      .eq('id', user.id)
      .select('id, username, full_name, bio')
      .single();
    setBusy(false);
    if (profileError) {
      setError(profileError.message);
      return;
    }
    setProfiles((current) => ({ ...current, [user.id]: data }));
    setEditingProfile(false);
    setNotice('Your profile has been updated.');
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="setup-screen">
        <div className="setup-card">
          <div className="brand-mark">l<span>.</span></div>
          <p className="eyebrow">YOUR LITTLE CORNER</p>
          <h1>One quick setup,<br />then you’re home.</h1>
          <p className="setup-copy">Add your Supabase project details to get sign in, profiles, posts, and comments working.</p>
          <ol className="setup-steps">
            <li><span>01</span><div><strong>Create a Supabase project</strong><small>Copy the project URL and anon/publishable key.</small></div></li>
            <li><span>02</span><div><strong>Set up your database</strong><small>Run the SQL in <code>supabase/schema.sql</code>.</small></div></li>
            <li><span>03</span><div><strong>Add your local settings</strong><small>Copy <code>.env.example</code> to <code>.env.local</code> and fill it in.</small></div></li>
          </ol>
          <p className="setup-footnote">For GitHub Pages, add the same values as repository Actions variables: <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>.</p>
        </div>
      </main>
    );
  }

  if (authLoading) {
    return <main className="loading-screen"><div className="brand-mark">l<span>.</span></div><p>Finding your place…</p></main>;
  }

  if (!user) {
    return (
      <main className="auth-screen">
        <section className="auth-art">
          <div className="brand-lockup"><div className="brand-mark">l<span>.</span></div><span>little social</span></div>
          <div className="art-copy">
            <p className="eyebrow">A SMALLER, SOFTER SOCIAL</p>
            <h1>Good things<br />grow <em>together.</em></h1>
            <p>A little corner of the internet to share your everyday, find your people, and be a little more you.</p>
          </div>
          <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
          <div className="art-note"><span>✳</span> made for the in-between moments</div>
        </section>
        <section className="auth-panel">
          <div className="auth-inner">
            <div className="mobile-brand"><div className="brand-mark">l<span>.</span></div><span>little social</span></div>
            <p className="eyebrow">YOUR PEOPLE ARE HERE</p>
            <h2>{authMode === 'signup' ? 'Come on in.' : 'Welcome back.'}</h2>
            <p className="auth-subtitle">{authMode === 'signup' ? 'Make a little space for yourself.' : 'We saved your seat.'}</p>
            <div className="auth-switch">
              <button className={authMode === 'signup' ? 'selected' : ''} onClick={() => { setAuthMode('signup'); setAuthError(''); setAuthNotice(''); }}>Create account</button>
              <button className={authMode === 'signin' ? 'selected' : ''} onClick={() => { setAuthMode('signin'); setAuthError(''); setAuthNotice(''); }}>Sign in</button>
            </div>
            <form className="auth-form" onSubmit={handleAuth}>
              {authMode === 'signup' && (
                <label>Your name<input autoComplete="name" value={authForm.name} onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })} placeholder="What should we call you?" required maxLength={60} /></label>
              )}
              <label>Email address<input type="email" autoComplete="email" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} placeholder="you@example.com" required /></label>
              <label>Password<input type="password" autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} placeholder="At least 6 characters" minLength={6} required /></label>
              {authError && <p className="message error">{authError}</p>}
              {authNotice && <p className="message success">{authNotice}</p>}
              <button className="primary-button auth-submit" disabled={busy}>{busy ? 'One moment…' : authMode === 'signup' ? 'Create my account' : 'Sign in'} <span>→</span></button>
            </form>
            <p className="auth-terms">A kind little place, built on respect and good conversations.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand-lockup" href="#" onClick={(event) => { event.preventDefault(); setActivePage('home'); }}>
          <div className="brand-mark">l<span>.</span></div><span>little social</span>
        </a>
        <div className="topbar-right">
          <span className="topbar-greeting">a little hello, {displayName.split(' ')[0]}</span>
          <button className="user-chip" onClick={() => setActivePage('profile')} aria-label="Open your profile"><Avatar name={displayName} small /></button>
          <button className="signout-button" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <p className="eyebrow sidebar-label">YOUR SPACE</p>
          <button className={`nav-item${activePage === 'home' ? ' active' : ''}`} onClick={() => setActivePage('home')}><span className="nav-icon">⌂</span> Home <span className="nav-dot" /></button>
          <button className={`nav-item${activePage === 'profile' ? ' active' : ''}`} onClick={() => setActivePage('profile')}><span className="nav-icon">◉</span> My profile</button>
          <div className="sidebar-profile">
            <Avatar name={displayName} />
            <div><strong>{displayName}</strong><small>@{ownProfile?.username || 'your-space'}</small></div>
          </div>
          <div className="sidebar-note"><span>✳</span><p>Small moments make a life. Share one today.</p></div>
          <div className="sidebar-bottom">A little more human, together.</div>
        </aside>

        <main className="main-content">
          <div className="content-column">
            <div className="page-heading">
              <div><p className="eyebrow">{activePage === 'home' ? 'YOUR LITTLE CORNER' : 'A LITTLE ABOUT YOU'}</p><h1>{activePage === 'home' ? 'The good stuff.' : 'Your space.'}</h1></div>
              <span className="heading-sparkle">✳</span>
            </div>
            {notice && <div className="message success page-message">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
            {error && <div className="message error page-message">{error}<button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}

            {activePage === 'home' ? (
              <>
                <form className="composer card" onSubmit={createPost}>
                  <div className="composer-top"><Avatar name={displayName} /><textarea aria-label="Write a post" maxLength={1000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="What’s on your mind today?" rows={3} /></div>
                  <div className="composer-footer"><span>{draft.length}/1000</span><button className="primary-button" disabled={busy || !draft.trim()}>Share a thought <span>↗</span></button></div>
                </form>
                <div className="feed-heading"><h2>Little moments</h2><span>{posts.length} {posts.length === 1 ? 'post' : 'posts'}</span></div>
                {feedLoading ? <div className="empty-state">Gathering the good stuff…</div> : posts.length ? (
                  <div className="post-list">{posts.map((post) => (
                    <article className="post-card card" key={post.id}>
                      <div className="post-author"><Avatar name={profiles[post.author_id]?.full_name || 'Friend'} /><div className="author-info"><strong>{profiles[post.author_id]?.full_name || 'Friend'}</strong><span>@{profiles[post.author_id]?.username || 'friend'} <i>·</i> {relativeTime(post.created_at)}</span></div><span className="post-flower">✳</span></div>
                      <p className="post-content">{post.content}</p>
                      <div className="comment-count">{(comments[post.id] ?? []).length ? `♡  ${(comments[post.id] ?? []).length} ${(comments[post.id] ?? []).length === 1 ? 'kind word' : 'kind words'}` : '♡  Leave a kind word'}</div>
                      {(comments[post.id] ?? []).map((comment) => (
                        <div className="comment" key={comment.id}><Avatar name={profiles[comment.author_id]?.full_name || 'Friend'} small /><div><strong>{profiles[comment.author_id]?.full_name || 'Friend'}</strong><span className="comment-time">{relativeTime(comment.created_at)}</span><p>{comment.content}</p></div></div>
                      ))}
                      <form className="comment-form" onSubmit={(event) => createComment(event, post.id)}>
                        <Avatar name={displayName} small /><input aria-label="Write a comment" maxLength={500} placeholder="Say something kind…" value={commentDrafts[post.id] ?? ''} onChange={(event) => setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))} /><button disabled={busy || !(commentDrafts[post.id] ?? '').trim()} aria-label="Send comment">↗</button>
                      </form>
                    </article>
                  ))}</div>
                ) : <div className="empty-state card"><span>☼</span><h3>A fresh start.</h3><p>Your feed is quiet for now. Share a thought and get the conversation going.</p></div>}
              </>
            ) : (
              <section className="profile-card card">
                <div className="profile-cover"><span>✳</span></div>
                <div className="profile-body">
                  <div className="profile-heading"><Avatar name={displayName} /><div><h2>{displayName}</h2><p>@{ownProfile?.username || 'your-space'}</p></div>
                    {!editingProfile && <button className="outline-button" onClick={() => setEditingProfile(true)}>Edit profile</button>}
                  </div>
                  {editingProfile ? (
                    <form className="profile-form" onSubmit={saveProfile}>
                      <label>Your name<input value={profileForm.full_name} onChange={(event) => setProfileForm({ ...profileForm, full_name: event.target.value })} required maxLength={60} /></label>
                      <label>Username<input value={profileForm.username} onChange={(event) => setProfileForm({ ...profileForm, username: event.target.value })} required maxLength={24} /><small>3–24 letters, numbers, or underscores.</small></label>
                      <label>A little about you<textarea value={profileForm.bio} onChange={(event) => setProfileForm({ ...profileForm, bio: event.target.value })} rows={3} maxLength={160} placeholder="The little things you love…" /><small>{profileForm.bio.length}/160</small></label>
                      <div className="form-actions"><button type="button" className="outline-button" onClick={() => setEditingProfile(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
                    </form>
                  ) : <p className={`profile-bio${ownProfile?.bio ? '' : ' muted'}`}>{ownProfile?.bio || 'Your story is yours to write. Add a little note about yourself.'}</p>}
                  <div className="profile-stats"><div><strong>{profilePosts.length}</strong><span>posts</span></div><div><strong>Here for it</strong><span>your little corner</span></div></div>
                </div>
                <div className="profile-posts"><h3>Your little moments</h3>{profilePosts.length ? profilePosts.map((post) => (
                  <div className="profile-post" key={post.id}><p>{post.content}</p><span>{relativeTime(post.created_at)} · {(comments[post.id] ?? []).length} comments</span></div>
                )) : <p className="muted profile-empty">Your first post is waiting to happen.</p>}</div>
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
