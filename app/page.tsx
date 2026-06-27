'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface Match {
  id: string;
  player: string[];
  current_turn_index: number;
  status: string;
}

interface Score {
  id: string;
  username: string;
  score: number;
}

interface Question {
  id: number;
  pertanyaan: string;
  jawaban: string;
  opsi: string[];
}

interface QuotesBank {
  pujian: string[];
  motivasi: string[];
}

export default function Home() {
  // State Flow & Data
  const [matches, setMatches] = useState<Match[]>([]);
  const [activeMatch, setActiveMatch] = useState<Match | null>(null);
  const [scores, setScores] = useState<Score[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [quotesBank, setQuotesBank] = useState<QuotesBank>({
    pujian: [],
    motivasi: [],
  });

  // User State
  const [username, setUsername] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [currentQuizIndex, setCurrentQuizIndex] = useState(0);
  const [myScoreId, setMyScoreId] = useState<string | null>(null);
  const [myScoreValue, setMyScoreValue] = useState(0);

  // Status & Teks Quote untuk Layar Hold
  const [lastAnswerStatus, setLastAnswerStatus] = useState<
    'CORRECT' | 'WRONG' | null
  >(null);
  const [currentHoldQuote, setCurrentHoldQuote] = useState<string>('');

  // UX State (Loading & Error)
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Ambil list room aktif di awal luar permainan
  useEffect(() => {
    fetchActiveMatches();

    const matchSubscription = supabase
      .channel('public:matches')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        () => {
          fetchActiveMatches();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(matchSubscription);
    };
  }, []);

  // Sinkronisasi Realtime saat sudah di dalam Room Match
  useEffect(() => {
    if (!activeMatch) return;

    fetchScores(activeMatch.id);

    const scoreSubscription = supabase
      .channel(`room:${activeMatch.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'scores',
          filter: `match_id=eq.${activeMatch.id}`,
        },
        () => {
          fetchScores(activeMatch.id);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'matches',
          filter: `id=eq.${activeMatch.id}`,
        },
        (payload) => {
          setActiveMatch(payload.new as Match);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(scoreSubscription);
    };
  }, [activeMatch?.id]);

  const fetchActiveMatches = async () => {
    const { data } = await supabase
      .from('matches')
      .select('*')
      .eq('status', 'ACTIVE')
      .order('date', { ascending: false });
    setMatches(data || []);
  };

  const fetchScores = async (matchId: string) => {
    const { data } = await supabase
      .from('scores')
      .select('*')
      .eq('match_id', matchId)
      .order('score', { ascending: false });
    setScores(data || []);
  };

  const createMatch = async () => {
    setIsLoading(true);
    const { data } = await supabase
      .from('matches')
      .insert([{ status: 'ACTIVE', current_turn_index: 0 }])
      .select()
      .single();
    setIsLoading(false);
    if (data) setActiveMatch(data);
  };

  const joinMatch = async (m: Match) => {
    setErrorMessage(null);
    setActiveMatch(m);
  };

  const submitUsername = async () => {
    if (!username.trim() || !activeMatch) return;

    setIsLoading(true);
    setErrorMessage(null);
    const cleanUsername = username.trim();

    try {
      // 1. Validasi Username Unik di Match ini
      const { data: existingUser } = await supabase
        .from('scores')
        .select('id')
        .eq('match_id', activeMatch.id)
        .ilike('username', cleanUsername);

      if (existingUser && existingUser.length > 0) {
        setErrorMessage(
          `Username "${cleanUsername}" sudah digunakan di match ini.`,
        );
        setIsLoading(false);
        return;
      }

      // 2. Tambah player ke array kolom matches
      const updatedPlayers = [...(activeMatch.player || []), cleanUsername];
      const { data: updatedMatch } = await supabase
        .from('matches')
        .update({ player: updatedPlayers })
        .eq('id', activeMatch.id)
        .select()
        .single();

      if (updatedMatch) setActiveMatch(updatedMatch);

      // 3. Daftarkan baris score baru
      const { data: scoreData } = await supabase
        .from('scores')
        .insert([
          { username: cleanUsername, score: 0, match_id: activeMatch.id },
        ])
        .select()
        .single();

      if (scoreData) setMyScoreId(scoreData.id);

      // 4. Ambil bank soal dan quotes sekaligus dari Apps Script
      const res = await fetch(process.env.NEXT_PUBLIC_APPSCRIPT_URL!);
      const json = await res.json();
      if (json.status === 'success') {
        setQuestions(json.data.questions);
        setQuotesBank(json.data.quotes);
      }

      setIsJoined(true);
    } catch (err) {
      setErrorMessage('Terjadi kesalahan koneksi database.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnswer = async (selected: string) => {
    if (!activeMatch) return;

    const currentQuestion = questions[currentQuizIndex];
    let isCorrect = selected === currentQuestion.jawaban;
    let newScore = myScoreValue;

    // Ambil quote acak berdasarkan hasil jawaban
    if (isCorrect) {
      newScore += 10;
      setMyScoreValue(newScore);
      setLastAnswerStatus('CORRECT');

      const pujianList = quotesBank.pujian;
      if (pujianList && pujianList.length > 0) {
        const randomQuote =
          pujianList[Math.floor(Math.random() * pujianList.length)];
        setCurrentHoldQuote(randomQuote);
      } else {
        setCurrentHoldQuote('Luar biasa, jawaban kamu tepat!');
      }

      if (myScoreId) {
        await supabase
          .from('scores')
          .update({ score: newScore })
          .eq('id', myScoreId);
      }
    } else {
      setLastAnswerStatus('WRONG');

      const motivasiList = quotesBank.motivasi;
      if (motivasiList && motivasiList.length > 0) {
        const randomQuote =
          motivasiList[Math.floor(Math.random() * motivasiList.length)];
        setCurrentHoldQuote(randomQuote);
      } else {
        setCurrentHoldQuote(
          'Jangan berkecil hati, coba lagi di giliran berikutnya!',
        );
      }
    }

    // Alihkan giliran ke player berikutnya secara berputar (Round-Robin)
    const nextTurnIndex =
      (activeMatch.current_turn_index + 1) % activeMatch.player.length;

    await supabase
      .from('matches')
      .update({ current_turn_index: nextTurnIndex })
      .eq('id', activeMatch.id);

    // Geser index soal pribadi ke nomor berikutnya
    setCurrentQuizIndex((prev) => (prev + 1) % questions.length);
  };

  const closeMatch = async () => {
    if (!activeMatch) return;
    await supabase
      .from('matches')
      .update({ status: 'FINISHED' })
      .eq('id', activeMatch.id);
  };

  const resetState = () => {
    setActiveMatch(null);
    setIsJoined(false);
    setUsername('');
    setQuestions([]);
    setQuotesBank({ pujian: [], motivasi: [] });
    setCurrentQuizIndex(0);
    setMyScoreValue(0);
    setMyScoreId(null);
    setLastAnswerStatus(null);
    setCurrentHoldQuote('');
    setErrorMessage(null);
    fetchActiveMatches();
  };

  // Tentukan siapa pemain yang saat ini harus menjawab
  const currentTurnPlayer =
    activeMatch?.player?.[activeMatch?.current_turn_index ?? 0];
  const isMyTurn = currentTurnPlayer === username;

  // --- VIEW 1: LOBBY UTAMA ---
  if (!activeMatch) {
    return (
      <div className='font-sans flex flex-col items-center justify-between min-h-screen bg-slate-900 text-slate-100 p-6'>
        <div className='w-full max-w-md text-center my-auto'>
          <h1 className='text-5xl font-black tracking-tight text-white mb-2'>
            PP Quiz
          </h1>
          <p className='text-slate-400 text-sm font-medium tracking-wide mb-8'>
            Realtime Turn-Based Multiplayer Trivia
          </p>

          <button
            onClick={createMatch}
            disabled={isLoading}
            className='w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg transition-all mb-10 flex justify-center items-center gap-2 tracking-wide'
          >
            {isLoading ? (
              <div className='w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin' />
            ) : (
              'Buka Match Baru'
            )}
          </button>

          <div className='text-left'>
            <h2 className='text-xs font-bold uppercase tracking-wider text-slate-400 mb-4 px-1'>
              Room Tersedia
            </h2>
            {matches.length === 0 ? (
              <div className='text-center p-8 bg-slate-800/40 border border-slate-800 rounded-2xl'>
                <p className='text-slate-500 text-sm italic font-medium'>
                  Belum ada room aktif sekarang.
                </p>
              </div>
            ) : (
              <div className='space-y-3 max-h-[350px] overflow-y-auto pr-1'>
                {matches.map((m) => (
                  <div
                    key={m.id}
                    className='flex justify-between items-center p-4 bg-slate-800/60 border border-slate-700/50 rounded-xl hover:border-slate-600 transition-all'
                  >
                    <div>
                      <p className='text-xs font-mono font-bold text-indigo-400'>
                        #ROOM-{m.id.substring(0, 6).toUpperCase()}
                      </p>
                      <p className='text-xs text-slate-400 font-medium mt-0.5'>
                        {m.player?.length || 0} pemain bergabung
                      </p>
                    </div>
                    <button
                      onClick={() => joinMatch(m)}
                      className='bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition'
                    >
                      Gabung
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* Watermark */}
        <footer className='text-center text-[11px] font-medium tracking-wider text-slate-600 mt-8'>
          made with love by{' '}
          <span className='text-slate-500 font-semibold'>
            KSCS Engineering Team
          </span>
        </footer>
      </div>
    );
  }

  // --- VIEW 2: INPUT USERNAME ---
  if (!isJoined) {
    return (
      <div className='font-sans flex flex-col items-center justify-between min-h-screen bg-slate-900 text-slate-100 p-6'>
        <div className='bg-slate-800/80 border border-slate-700/60 p-8 rounded-2xl shadow-xl w-full max-w-sm backdrop-blur-sm my-auto'>
          <button
            onClick={() => setActiveMatch(null)}
            className='text-xs font-semibold text-slate-400 hover:text-white mb-4 transition block'
          >
            ← Kembali ke Lobby
          </button>
          <h2 className='text-xl font-bold text-white mb-1 tracking-tight'>
            Identitas Pemain
          </h2>
          <p className='text-xs font-medium text-slate-400 mb-5'>
            Username harus unik per pertandingan.
          </p>

          {errorMessage && (
            <div className='mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl font-semibold'>
              {errorMessage}
            </div>
          )}

          <input
            type='text'
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder='Masukkan username...'
            disabled={isLoading}
            className='w-full bg-slate-900/50 border border-slate-700/80 p-3.5 rounded-xl mb-4 text-white font-medium focus:outline-none focus:border-indigo-500 text-sm transition-all'
          />

          <button
            onClick={submitUsername}
            disabled={isLoading || !username.trim()}
            className='w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 text-white py-3.5 rounded-xl font-bold transition-all text-sm flex justify-center items-center gap-2 tracking-wide'
          >
            {isLoading ? (
              <div className='w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin' />
            ) : (
              'Masuk ke Arena'
            )}
          </button>
        </div>
        {/* Watermark */}
        <footer className='text-center text-[11px] font-medium tracking-wider text-slate-600 mt-8'>
          made with love by{' '}
          <span className='text-slate-500 font-semibold'>
            KSCS Engineering Team
          </span>
        </footer>
      </div>
    );
  }

  // --- VIEW 3: GAME OVER / FINISHED MATCH ---
  if (activeMatch.status === 'FINISHED') {
    return (
      <div className='font-sans flex flex-col items-center justify-between min-h-screen bg-slate-950 text-slate-100 p-6'>
        <div className='w-full max-w-md text-center my-auto'>
          <div className='inline-block bg-red-500/10 text-red-400 text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full border border-red-500/20 mb-3'>
            Pertandingan Selesai
          </div>
          <h1 className='text-4xl font-black text-white mb-8 tracking-tight'>
            Papan Skor Akhir
          </h1>

          <div className='bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-2xl mb-8'>
            <div className='space-y-2.5'>
              {scores.map((s, idx) => (
                <div
                  key={s.id}
                  className={`flex justify-between items-center p-3.5 rounded-xl ${s.username === username ? 'bg-indigo-600/20 border border-indigo-500/30 text-white' : 'bg-slate-800/40 border border-slate-800 text-slate-300'}`}
                >
                  <span className='font-semibold text-sm truncate max-w-[200px]'>
                    <span className='text-slate-500 mr-2 font-mono font-bold'>
                      #{idx + 1}
                    </span>
                    {s.username}{' '}
                    {s.username === username && (
                      <span className='text-xs font-bold text-indigo-400 ml-1'>
                        (Kamu)
                      </span>
                    )}
                  </span>
                  <span className='font-mono font-bold text-sm bg-slate-950/40 px-2.5 py-1 rounded-lg border border-slate-800/60'>
                    {s.score} Pts
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={resetState}
            className='bg-slate-800 hover:bg-slate-700 text-white font-semibold px-6 py-3 rounded-xl transition tracking-wide text-sm'
          >
            Kembali ke Lobby Utama
          </button>
        </div>
        {/* Watermark */}
        <footer className='text-center text-[11px] font-medium tracking-wider text-slate-600 mt-8'>
          made with love by{' '}
          <span className='text-slate-500 font-semibold'>
            KSCS Engineering Team
          </span>
        </footer>
      </div>
    );
  }

  // --- VIEW 4: SCREEN UTAMA (GAMEPLAY + LIVE LEADERBOARD) ---
  return (
    <div className='font-sans min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 flex flex-col justify-between max-w-7xl mx-auto'>
      <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 items-start w-full'>
        {/* Kolom Kuis & Aturan Giliran Multiplayer */}
        <div className='lg:col-span-2 min-h-[420px] flex flex-col'>
          {questions.length > 0 ? (
            isMyTurn ? (
              /* KAMU SEDANG MENDAPAT GILIRAN BERTANYA */
              <div className='bg-slate-900 border border-indigo-500/30 p-6 md:p-8 rounded-2xl shadow-xl flex-1 flex flex-col justify-between'>
                <div className='w-full'>
                  <div className='flex justify-between items-center mb-8'>
                    <span className='text-xs bg-indigo-500/20 text-indigo-300 font-mono font-bold px-3 py-1.5 rounded-lg border border-indigo-500/30 animate-pulse tracking-wide'>
                      ⚡ GILIRAN KAMU BERMAIN
                    </span>
                    <span className='text-xs font-semibold text-slate-400 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 tracking-wide'>
                      Skor Anda:{' '}
                      <strong className='text-emerald-400 font-mono text-sm ml-1 font-bold'>
                        {myScoreValue}
                      </strong>
                    </span>
                  </div>

                  <h2 className='text-xl md:text-2xl font-bold text-white tracking-tight leading-relaxed mb-8'>
                    {questions[currentQuizIndex].pertanyaan}
                  </h2>

                  <div className='space-y-3'>
                    {questions[currentQuizIndex].opsi.map((opsi, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleAnswer(opsi)}
                        className='w-full text-left p-4 rounded-xl border border-slate-800 bg-slate-950/40 hover:bg-slate-800 hover:border-indigo-500 text-slate-300 hover:text-white font-semibold text-sm transition-all duration-150'
                      >
                        {opsi}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* SCREEN HOLD (MENUNGGU GILIRAN PLAYER LAIN SEKALIGUS MENAMPILKAN QUOTE) */
              <div
                className={`flex-1 flex flex-col justify-center items-center text-center p-8 rounded-2xl border transition-all duration-300 ${
                  lastAnswerStatus === 'CORRECT'
                    ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-100'
                    : lastAnswerStatus === 'WRONG'
                      ? 'bg-rose-950/80 border-rose-500/30 text-rose-100'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                {/* Tampilan Quote Elegan */}
                <div className='max-w-md my-auto px-4 py-6'>
                  <span className='text-[10px] font-bold uppercase tracking-widest opacity-60 block mb-3'>
                    {lastAnswerStatus === 'CORRECT'
                      ? '✨ Apresiasi Untukmu'
                      : lastAnswerStatus === 'WRONG'
                        ? '💡 Catatan Refleksi'
                        : 'Kuis Dimulai'}
                  </span>

                  <p className='text-lg md:text-xl font-medium text-white italic leading-relaxed tracking-wide mb-4'>
                    "
                    {currentHoldQuote ||
                      'Bersiaplah untuk giliran kamu berikutnya.'}
                    "
                  </p>

                  <div className='w-12 h-[2px] bg-white/20 mx-auto mb-6' />
                </div>

                <p className='text-xs font-medium text-slate-400 leading-relaxed mb-6'>
                  Sekarang saatnya giliran{' '}
                  <span className='font-bold text-indigo-400'>
                    @{currentTurnPlayer || 'Pemain Lain'}
                  </span>{' '}
                  untuk menjawab soal mereka.
                </p>

                <div className='flex items-center gap-2 bg-slate-950/60 px-4 py-2.5 rounded-xl border border-slate-800/40'>
                  <div className='w-2 h-2 rounded-full bg-amber-500 animate-ping' />
                  <span className='text-xs font-mono tracking-wider uppercase text-amber-400 font-bold'>
                    Menunggu Giliran Selanjutnya...
                  </span>
                </div>
              </div>
            )
          ) : (
            <div className='flex flex-col items-center justify-center flex-1 py-12 bg-slate-900 border border-slate-800 rounded-2xl'>
              <div className='w-8 h-8 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-3' />
              <p className='text-sm font-medium text-slate-500 animate-pulse'>
                Menghubungkan bank soal kuis...
              </p>
            </div>
          )}
        </div>

        {/* Kolom Realtime Leaderboard & Info Room */}
        <div className='bg-slate-900 border border-slate-800/80 p-6 rounded-2xl shadow-xl flex flex-col justify-between lg:sticky lg:top-8'>
          <div>
            <div className='flex justify-between items-center mb-5 border-b border-slate-800 pb-3'>
              <div>
                <h2 className='text-sm font-bold text-white uppercase tracking-wider'>
                  Papan Peringkat
                </h2>
                <p className='text-[10px] text-slate-500 font-mono font-bold mt-0.5'>
                  ROOM: #{activeMatch.id.substring(0, 6).toUpperCase()}
                </p>
              </div>
              <div className='flex items-center gap-1.5'>
                <span className='w-2 h-2 rounded-full bg-emerald-500 animate-pulse' />
                <span className='text-[10px] font-mono text-emerald-500 uppercase tracking-widest font-black'>
                  Realtime
                </span>
              </div>
            </div>

            <div className='space-y-2 max-h-[320px] overflow-y-auto pr-1'>
              {scores.map((s, idx) => {
                const isPlayerTurnNow = currentTurnPlayer === s.username;
                return (
                  <div
                    key={s.id}
                    className={`flex justify-between items-center p-3 rounded-xl transition-all ${
                      s.username === username
                        ? 'bg-indigo-600/10 border border-indigo-500/30 text-white'
                        : 'bg-slate-950/40 border border-slate-850 text-slate-400'
                    } ${isPlayerTurnNow ? 'ring-1 ring-amber-500/50' : ''}`}
                  >
                    <span className='text-xs font-semibold truncate max-w-[150px] flex items-center gap-1'>
                      <span className='font-mono font-bold text-slate-600 mr-0.5'>
                        #{idx + 1}
                      </span>
                      {s.username}
                      {s.username === username && ' (Anda)'}
                      {isPlayerTurnNow && (
                        <span className='text-[9px] bg-amber-500/20 text-amber-400 px-1 py-0.2 rounded font-sans font-bold ml-1'>
                          🔴 Giliran
                        </span>
                      )}
                    </span>
                    <span className='text-xs font-mono font-bold text-slate-200 bg-slate-900 px-2 py-0.5 rounded border border-slate-800'>
                      {s.score} pts
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            onClick={closeMatch}
            className='mt-8 w-full bg-red-950 hover:bg-red-900 border border-red-800/40 text-red-400 font-bold py-3 rounded-xl text-xs uppercase tracking-wider transition-all'
          >
            Selesaikan Pertandingan
          </button>
        </div>
      </div>

      {/* Watermark */}
      <footer className='text-center text-[11px] font-medium tracking-wider text-slate-600 mt-12 w-full'>
        made with love by{' '}
        <span className='text-slate-500 font-semibold'>
          KSCS Engineering Team
        </span>
      </footer>
    </div>
  );
}
