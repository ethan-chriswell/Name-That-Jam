(function(){
  "use strict";
  const socket=io();
  const decades=["1950s","1960s","1970s","1980s","1990s","2000s","2010s","2020s"];
  const selected=new Set(decades);
  let state=null,player=null,timerHandle=null,playerCreating=false,pendingPlayback=null,lastPlaybackState="",playbackRoundAck=0,typedRound=0,yearRound=0;
  const $=id=>document.getElementById(id);
  function screen(id){document.querySelectorAll(".screen").forEach(el=>el.classList.toggle("active",el.id===id))}
  function toast(message){$("toast").textContent=message;$("toast").style.display="block";setTimeout(()=>$("toast").style.display="none",3500)}
  decades.forEach(decade=>{const b=document.createElement("button");b.className="decade on";b.textContent=decade;b.onclick=()=>{selected.has(decade)?selected.delete(decade):selected.add(decade);b.classList.toggle("on")};$("decades").appendChild(b)});
  $("show-setup").onclick=()=>{document.body.classList.add("is-host");screen("setup")};
  $("create-room").onclick=()=>socket.emit("create-room",{decades:[...selected],rounds:+$("rounds").value,difficulty:$("difficulty").value,mode:$("answer-mode").value},result=>{if(!result.ok)return toast(result.error);history.replaceState(null,"",`/?host=${result.code}`)});
  $("join-form").onsubmit=e=>{e.preventDefault();join($("room-code").value,$("player-name").value)};
  function join(code,name){socket.emit("join-room",{code,name},result=>{if(!result.ok)toast(result.error);else history.replaceState(null,"",`/?room=${code}`)})}
  $("start-game").onclick=()=>socket.emit("start-game");
  $("reveal").onclick=()=>socket.emit("reveal");
  $("typed-answer-form").onsubmit=e=>{e.preventDefault();const value=$("typed-answer").value.trim();if(value)socket.emit("answer",value)};
  $("year-answer-form").onsubmit=e=>{e.preventDefault();const title=$("year-song-answer").value.trim();if(!title)return;socket.emit("answer",{title,year:$("year-answer").value?+$("year-answer").value:null,artist:$("artist-bonus").value.trim()})};
  function runPlayback(action){if(!player||!state?.videoId)return;if(action==="cue")player.cueVideoById({videoId:state.videoId,startSeconds:20});if(action==="play")player.loadVideoById({videoId:state.videoId,startSeconds:20});if(action==="stop")player.stopVideo()}
  function playbackChanged(event){if(event.data===YT.PlayerState.PLAYING&&state?.isHost&&state.phase==="loading"&&playbackRoundAck!==state.round){playbackRoundAck=state.round;socket.emit("playback-started",state.round)}}
  function withPlayer(action){pendingPlayback=action;if(player)return runPlayback(action);if(playerCreating||!window.YT?.Player)return;playerCreating=true;new YT.Player("yt-player",{height:"1",width:"1",playerVars:{controls:0},events:{onReady:e=>{player=e.target;playerCreating=false;runPlayback(pendingPlayback)},onStateChange:playbackChanged}})}
  function syncPlayback(s){if(!s.isHost)return;const key=`${s.round}:${s.phase}`;if(key===lastPlaybackState)return;lastPlaybackState=key;if(s.phase==="countdown")withPlayer("cue");else if(s.phase==="loading")withPlayer("play");else if(s.phase==="reveal"||s.phase==="finished")withPlayer("stop")}
  window.onYouTubeIframeAPIReady=()=>{lastPlaybackState="";if(state?.isHost)syncPlayback(state)};
  $("play-clip").onclick=()=>withPlayer("play");
  function list(target,players){$(target).innerHTML=players.map((p,i)=>`<li><span>${i+1}. ${escapeHtml(p.name)} ${p.answered?'<span class="answered">✓</span>':''}${p.roundPoints>0?`<span class="points-earned">+${p.roundPoints}</span>`:""}</span><strong>${p.score}</strong></li>`).join("")}
  function escapeHtml(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML}
  function render(s){state=s;
    document.body.classList.toggle("is-host",!!s.isHost);
    clearInterval(timerHandle);
    if(s.phase==="lobby"){screen("lobby");$("room-code-display").textContent=s.code;$("join-address").textContent=location.host;$("qr").src=`/api/rooms/${s.code}/qr`;$("player-count").textContent=s.players.length;$("lobby-players").innerHTML=s.players.map(p=>`<span class="player">${escapeHtml(p.name)}</span>`).join("");$("start-game").disabled=!s.players.length;$("start-game").hidden=!s.isHost;$("start-note").hidden=s.isHost&&s.players.length>0;return}
    syncPlayback(s);
    if(s.phase==="finished"){screen("finished");list("final-leaderboard",s.players);return}
    screen("game");$("round-label").textContent=`ROUND ${s.round} / ${s.totalRounds}`;$("decade-label").textContent=s.decade;$("host-stage").hidden=!s.isHost||!["loading","question"].includes(s.phase);$("countdown-panel").hidden=s.phase!=="countdown";$("loading-panel").hidden=s.phase!=="loading"||s.isHost;$("question").hidden=s.phase!=="question"||s.isHost;$("reveal-panel").hidden=s.phase!=="reveal";$("reveal").hidden=!s.isHost||s.phase!=="question";
    const answeredCount=s.players.filter(p=>p.answered).length,responsePercent=s.players.length?answeredCount/s.players.length*100:0;$("response-fill").style.width=`${responsePercent}%`;$("host-response-count").textContent=`${answeredCount} of ${s.players.length} players answered`;$('host-record').classList.toggle("playing",s.phase==="question");
    const tick=()=>{const remaining=s.deadline?Math.max(0,Math.ceil((s.deadline-Date.now())/1000)):0;$("timer").textContent=s.deadline?`${remaining}s`:"";if(s.phase==="countdown")$("countdown-number").textContent=remaining;if(s.phase==="reveal")$("next-countdown").textContent=s.round===s.totalRounds?`Final scores in ${remaining}…`:`Next round in ${remaining}…`};tick();if(s.deadline)timerHandle=setInterval(tick,250);
    $("choices").innerHTML=s.choices.map(c=>`<button class="choice" ${s.isHost||s.answered?'disabled':''}>${escapeHtml(c)}</button>`).join("");document.querySelectorAll(".choice").forEach(b=>b.onclick=()=>{socket.emit("answer",b.textContent);b.classList.add("selected")});
    const typed=s.settings.mode==="type"&&!s.isHost;if(typed&&typedRound!==s.round){typedRound=s.round;$("typed-answer").value=""}$("typed-answer-form").hidden=!typed;$("typed-answer").disabled=s.answered;if(typed&&!s.answered&&s.phase==="question")$("typed-answer").focus();
    const yearMode=s.settings.mode==="year"&&!s.isHost;if(yearMode&&yearRound!==s.round){yearRound=s.round;$("year-song-answer").value="";$("year-answer").value="";$("artist-bonus").value=""}$("year-answer-form").hidden=!yearMode;$("year-song-answer").disabled=s.answered;$("year-answer").disabled=s.answered;$("artist-bonus").disabled=s.answered;$("question-prompt").textContent=yearMode?"What song is this? (+bonus for year & artist)":"What song is this?";if(yearMode&&!s.answered&&s.phase==="question")$("year-song-answer").focus();
    $("answer-status").textContent=s.isHost?`${s.players.filter(p=>p.answered).length} of ${s.players.length} answered`:s.answered?"Answer locked in!":"Choose your answer";
    if(s.answer){$("answer-title").textContent=s.answer.title;$("answer-artist").textContent=s.answer.artist;$("answer-year").textContent=s.settings.mode==="year"?`Released ${s.answer.releaseYear}`:""}$("round-results").innerHTML=s.phase==="reveal"?s.players.map(p=>{const badges=`${p.roundYearBonus?'<span class="points-earned">★ year</span>':''}${p.roundArtistBonus?'<span class="points-earned">★ artist</span>':''}`;const result=p.roundPoints>0?`+${p.roundPoints}`:'Wrong';return `<li><span class="result-icon ${p.roundCorrect?'right':'wrong'}">${p.roundCorrect?'✓':'✕'}</span><span class="result-name">${escapeHtml(p.name)}${badges}</span><strong class="${p.roundPoints>0?'right':'wrong'}">${result}</strong></li>`}).join(""):"";list("leaderboard",s.players);
  }
  socket.on("state",render);socket.on("room-closed",()=>{toast("The host closed the room.");setTimeout(()=>location.href="/",1200)});
  const params=new URLSearchParams(location.search);if(params.has("room")){const code=params.get("room");$("room-code").value=code;$("room-code").hidden=true;$("join-hint").textContent=`Joining room ${code} — just add your name.`;$("player-name").focus()}
})();
