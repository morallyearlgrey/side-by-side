"""Forty assistant-authored draft review cases, excluded from fitting/selection.

Profile wording below is not produced by the training sentence templates.
The author and label assumptions are still shared; this is NOT an independent
human benchmark. Preserve these cases after reporting failures.
"""

from .dataset_builder import add_history_family, fact


def add_challenge(builder):
    cases = [
        ("zines", "two-color screen printing", "learn", "Get practical help lining up two ink layers on a homemade poster", {
            "viewer": (
                [fact("screen printing", "wants_to_try", "Our dorm is making gig posters. My first print came out with the red layer several millimeters off; I'd love to try a two-color design again."),
                 fact("small music venues", "interested", "I like discovering small live-music venues, especially shows where I can meet the performers."),
                 fact("guitar effects", "learning", "I have started soldering a basic distortion pedal.")],
                "Meet someone who has actually aligned multiple stencil layers, or another novice to experiment beside.",
                ["Registration tricks for homemade prints", "Practicing printmaking with another newcomer"], []),
            "expert": (
                [fact("screen printing", "experienced", "Spent Saturday getting two ink passes to sit exactly on top of one another: taped hinges, a paper stop, and several sacrificial test sheets.", "post"),
                 fact("screen printing", "can_share", "Happy to talk through how I register my layers on a tiny homemade printing rig."),
                 fact("independent publishing", "interested", "I collect hand-bound zines and trade them at local print fairs.")],
                "Pass on the practical things I learned getting two-color artwork onto paper.",
                ["Homemade print setup", "Questions from first-time printmakers"], ["Show a failed attempt and figure it out together"]),
            "narrow": (
                [fact("screen printing", "experienced", "I printed two-color posters for a campus show last spring."),
                 fact("poster design history", "interested", "I'm researching lettering styles on twentieth-century concert posters.")],
                "Right now I want to compare archival poster lettering. Printing setup and troubleshooting are off my agenda today.",
                ["Archival poster typography"], []),
            "peer": (
                [fact("screen printing", "learning", "I have a borrowed screen and a rough stencil, but haven't made a successful print yet.")],
                "Find a fellow beginner to make messy test prints with; advice from someone experienced would also be welcome.",
                ["Practicing simple posters together", "Beginner printing advice"], []),
            "other": (
                [fact("concert sound", "experienced", "I mixed vocals for three small student gigs."),
                 fact("concert sound", "interested", "I enjoy comparing ways to stop microphone feedback.")],
                "Find someone to discuss live microphone placement today.", ["Live sound"], ["Concrete examples"]),
        }),
        ("transit", "accessible transit-map design", "learn", "Find someone who has made a route map understandable without relying on color", {
            "viewer": (
                [fact("transit maps", "learning", "I'm drawing a shuttle diagram for new students. Several routes cross and I don't want readers to depend on red versus green."),
                 fact("board games", "experienced", "I have made icons to distinguish resources in a home-designed board game.")],
                "Learn from somebody who has tested a diagram with redundant symbols, or compare sketches with a fellow beginner.",
                ["Practical map readability", "Working on diagrams together"], ["Ask questions while looking at a concrete example"]),
            "expert": (
                [fact("readable transit diagrams", "experienced", "We tried our bus diagram in grayscale and replaced color-only route lines with separate patterns and stop symbols."),
                 fact("readable transit diagrams", "can_share", "I can explain the patterns and labels we changed after testing the diagram; questions are welcome."),
                 fact("rail travel", "interested", "I like short rail trips where I can walk around the destination.")],
                "Share what testing a bus map taught me about symbols, contrast, and confusing interchanges.",
                ["Readable route diagrams", "Beginner design questions"], []),
            "narrow": (
                [fact("transit maps", "experienced", "I redesigned a shuttle map using dashed routes and numbered stops."),
                 fact("transit archives", "interested", "I collect historical station-name changes.")],
                "Spend this break trading stories about old station names; I am not doing design feedback today.",
                ["Station-name history"], ["Concrete examples"]),
            "peer": (
                [fact("transit diagrams", "wants_to_try", "I want to redraw my town's confusing bus map, but I've never tested a map with readers.")],
                "Work beside another beginner on a first map, and learn from people who've already tried it.",
                ["Map-making practice", "Advice on first drafts"], ["A quiet side-by-side activity"]),
            "other": (
                [fact("public transport", "interested", "I track bus-engine maintenance schedules."),
                 fact("public transport", "can_share", "I can talk about fleet maintenance and spare parts.")],
                "Compare maintenance schedules for vehicle fleets.", ["Vehicle maintenance logistics"], []),
        }),
        ("animation", "tabletop stop-motion", "learn", "Hear how someone kept a phone steady and lighting consistent during a stop-motion shoot", {
            "viewer": (
                [fact("stop-motion", "wants_to_try", "I want to animate a paper character on my desk. Every time I touch the phone the whole frame jumps."),
                 fact("tea", "interested", "I like slow afternoons trying different teas."),
                 fact("paper crafts", "experienced", "I made folded-paper decorations for a student event.")],
                "Pick up phone-rig and lighting tips from a maker; I'd also enjoy trying another shoot with a novice.",
                ["DIY animation setup", "Making short clips together"], []),
            "expert": (
                [fact("stop-motion", "experienced", "Thirty seconds of paper animation took me all weekend. Locking exposure and clamping my phone to a stack of books finally stopped the flicker and camera drift.", "post"),
                 fact("stop-motion", "can_share", "Ask me about the improvised phone clamp or the desk-lamp setup; I'd enjoy showing what worked.")],
                "Show another beginner how I kept a tiny animation shoot stable.",
                ["Phone stabilization", "Consistent lighting for short animations"], []),
            "narrow": (
                [fact("stop-motion", "experienced", "I've made short stop-motion films with locked camera exposure."),
                 fact("animation history", "interested", "I read about early studio animation techniques.")],
                "Chat about the history of animation studios, not current filming setups.",
                ["Animation studio history"], []),
            "peer": (
                [fact("paper animation", "learning", "I have cut out paper figures but haven't managed to film a stable sequence.")],
                "Find company for a first proper shoot and hear tips from anyone who has finished one.",
                ["Trying stop-motion together", "First-shoot advice"], ["Try something, then compare the results"]),
            "other": (
                [fact("film screenings", "interested", "I organize screenings and keep track of campus room bookings.")],
                "Trade ideas about audience tickets and screening-room bookings.", ["Event logistics"], ["Patient back-and-forth"]),
        }),
        ("language", "everyday Portuguese conversation", "learn", "Get firsthand ideas for starting a short unscripted conversation in Portuguese", {
            "viewer": (
                [fact("Portuguese", "learning", "I can read simple Portuguese menus, but I freeze when someone replies with words I didn't rehearse."),
                 fact("music", "interested", "I like acoustic live sets in small cafes.")],
                "Hear how another learner got comfortable with everyday chats, or practice with someone at my level.",
                ["Everyday speaking practice", "Stories about getting past rehearsed phrases"], ["A relaxed exchange with pauses to think"]),
            "expert": (
                [fact("Portuguese conversation", "experienced", "While visiting Porto I kept a notebook of follow-up questions and used them in short cafe conversations. It helped when the answer wasn't what I expected."),
                 fact("Portuguese conversation", "can_share", "I'm happy to share the questions that kept those conversations going, and listen to beginner attempts."),
                 fact("travel food", "interested", "I enjoy talking with people about regional food markets.")],
                "Share practical experiences of moving beyond memorized Portuguese phrases.",
                ["Beginner speaking questions", "Everyday conversation stories"], ["Pause for questions and let each person finish"]),
            "narrow": (
                [fact("Portuguese", "experienced", "I have used Portuguese in everyday conversations while traveling."),
                 fact("historical linguistics", "interested", "I compare medieval spelling conventions.")],
                "Talk about the evolution of Portuguese spelling today. Speaking exercises can wait for another time.",
                ["History of spelling"], []),
            "peer": (
                [fact("Portuguese", "wants_to_try", "I've only practiced scripted dialogues; I want to try answering unexpected questions for the first time.")],
                "Practice slowly with another novice and get suggestions from people who have actually tried unscripted chats.",
                ["Beginner speaking practice", "Firsthand learning suggestions"], []),
            "other": (
                [fact("Portuguese football", "interested", "I follow club transfer news and compare player statistics."),
                 fact("Portuguese football", "can_share", "I welcome questions about league transfers.")],
                "Debate this season's league transfers, rather than language-learning methods.",
                ["League transfer news"], ["Casual back-and-forth"]),
        }),
    ]
    for name, topic, mode, goal, specs in cases:
        group = "challenge_" + name
        people = {key: builder.profile(group, "test", key, *spec) for key, spec in specs.items()}
        a, b, c, d, e = [people[key] for key in ("viewer", "expert", "narrow", "peer", "other")]
        builder.pair(a, b, mode, goal, 1, "Detailed experience and explicit willingness address the stated practical question.", "experience_aspiration")
        builder.pair(b, a, "share", b["current_goal"], 1, "The viewer offers firsthand learning experiences and the candidate explicitly welcomes them.", "reverse_willingness")
        builder.pair(a, c, mode, goal, 0, "Similar experience does not override the candidate's explicitly different conversation choice today.", "same_topic_different_intent")
        builder.pair(c, a, "casual_chat", c["current_goal"], 0, "The viewer wants a narrowly specified history discussion; the candidate instead seeks practical learning or practice.", "same_topic_different_intent")
        builder.pair(a, d, mode, goal, None, "A fellow beginner might be good company but has not supplied the requested firsthand results.", "unknown_experience")
        builder.pair(d, a, "find_activity_partner", d["current_goal"], 1, "Both explicitly welcome beginner practice together.", "beginner_companionship")
        builder.pair(a, e, mode, goal, 0, "The candidate has explicitly chosen a different discussion, not the requested practical subject.", "different_current_goal")
        builder.pair(b, d, "share", b["current_goal"], 1, "The novice welcomes firsthand suggestions on exactly the activity the viewer offers to discuss.", "reverse_willingness")

    # Same controlled construction as training: a mechanism check, not a novel
    # personalization benchmark. New domain, wording, and people; draft labels.
    topic = "tasting loose-leaf tea"
    people = add_history_family(builder, "challenge_history", "test", topic,
        "I brewed the same tea at several temperatures and compared how bitter or sweet the cups tasted.",
        ("Brew little cups together and discuss what each person notices in the moment",
         "Read a structured explanation of extraction chemistry before tasting anything"))
    for i, other_topic in enumerate(("tea-shop signage", "shipping tea internationally")):
        other = builder.profile("challenge_history", "test", f"other_{i}",
            [fact(other_topic, "interested", f"My main interest is {other_topic}.")],
            f"Compare ideas about {other_topic}; tasting methods aren't my conversation today.", [other_topic])
        for key in ("viewer_a", "viewer_b"):
            viewer = people[key]
            history = [h["feedback_id"] for h in builder.bundle["feedback"]
                       if h["viewer_profile_version_id"] == viewer["profile_version_id"]]
            builder.pair(viewer, other, "learn", viewer["current_goal"], 0,
                "Current interests explicitly differ from the requested tea-tasting conversation, regardless of prior style feedback.",
                "different_current_goal", history)
