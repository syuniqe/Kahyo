# Rhyme: read me

**Status: live on beta.**

**For:** poems, lyrics and songs.

**Map:** top to bottom, the way a piece is read.

**Phases:** verse (a para), chorus, bridge. Unlike story stages, a phase such as the chorus can come back.

## How it works

1. **A line comes in.** Spoken or typed, one line or image per Footstep. It joins a section (Verse 1, Chorus, Bridge, Outro): the writer's pick, the AI's, or the section of the line before.
2. **Theme.** ThoughtSense measures how far the line strays from the theme of the piece so far. The limit is wide in the bridge, tight in the chorus and outro.
3. **Chorus returns.** A chorus line that matches one from an earlier chorus is a return, never a repeat. A chorus that comes back with lines changed raises one note.
4. **Bridge turn.** A bridge that does not turn away from the verses raises a note.
5. **Meter and rhyme.** Syllables against the section's usual count, and end sounds against the lines around it. Soft notes; free verse is never flagged.
6. **Set aside.** A line that goes a lot in a strange direction is offered to be set aside.

`rules.js` holds the maths; the exact formulas are in the private maths doc.
