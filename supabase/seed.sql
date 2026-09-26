-- LOCAL DEVELOPMENT ONLY. Fictional profiles, no passwords or usable accounts.
-- Supabase CLI db reset applies this file locally. Never use as a production import.
do $$
declare n integer; uid uuid; sid uuid; aid uuid; version_id uuid; content text; a jsonb;
begin
  for n in 1..4 loop
    uid := ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
    sid := ('20000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
    aid := ('30000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
    version_id := ('40000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
    if exists(select 1 from public.profile_versions where profile_version_id=version_id) then continue; end if;
    insert into auth.users(id,aud,role,email,created_at,updated_at)
      values(uid,'authenticated','authenticated','synthetic-'||n||'@sidebyside.invalid',now(),now()) on conflict(id) do nothing;
    insert into public.onboarding_sessions(session_id,user_id,status,completed_at) values(sid,uid,'completed',now());
    content := case n when 1 then 'I want to learn more about beginner urban gardening.'
      when 2 then 'I can share my experience growing vegetables on a balcony.'
      when 3 then 'I like urban gardening but live outside the demo radius.'
      else 'I enjoy gardening, but my location observation is expired.' end;
    insert into public.onboarding_answers(answer_id,session_id,user_id,question_key,question_text,answer_text)
      values(aid,sid,uid,'interests','What makes you YOU?',content);
    select jsonb_build_array(jsonb_build_object('answer_id',answer_id,'question_key',question_key,'question_text',question_text,
      'answer_text',answer_text,'answered_at',answered_at)) into a from public.onboarding_answers where answer_id=aid;
    insert into public.profile_versions(profile_version_id,user_id,onboarding_session_id,data_origin,onboarding_answers,
      current_goal,conversation_intent,facts,open_to_discussing)
      values(version_id,uid,sid,'synthetic',a,'Talk about growing food in a city',case when n=2 then 'share' else 'learn' end,
        jsonb_build_array(jsonb_build_object('fact_id','garden-'||n,'topic','urban gardening','relationship',case when n=2 then 'can_share' else 'interested' end,
          'details',content,'motivation',null,'evidence',jsonb_build_array(jsonb_build_object('source_type','onboarding_answer','reference_id',aid,
          'channel','self_report','support',content)),'confirmation','confirmed','matching_allowed',true,'sharing_scope','after_mutual_consent')),
        array['urban gardening']);
    insert into public.consent_receipts(user_id,purpose,policy_version) values(uid,'personal_matching','synthetic-demo-v1');
    update public.profiles set display_name='Synthetic neighbor '||n,current_profile_version_id=version_id,discoverable=true where user_id=uid;
    insert into public.profile_previews(user_id,enabled,preview) values(uid,true,
      jsonb_build_object('display_name','Synthetic neighbor '||n,'headline','Fictional local test profile','interests',jsonb_build_array('urban gardening')));
    insert into public.presence(user_id,latitude,longitude,accuracy_m,observed_at,expires_at)
      values(uid,case n when 1 then 40.7128 when 2 then 40.7200 when 3 then 40.8000 else 40.7130 end,-74.0060,10,
        case when n=4 then now()-interval '20 minutes' else now() end,
        case when n=4 then now()-interval '10 minutes' else now()+interval '10 minutes' end);
  end loop;
end;
$$;
