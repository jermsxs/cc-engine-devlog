---
title: The scare becomes a C# script
date: 2026-10-01
order: 1
summary: The engine now hosts the .NET runtime, so gameplay such as the hallway's scare is C# you can write, attach and rebuild in seconds without touching the engine.
tags: scripting, gameplay
cover: /images/2026-10-01-csharp-scripting/scare-scripted.jpg
---

Up to now, every bit of gameplay in the hallway was hard-wired C++ inside the game session. The scare, the lamp flicker, the "It's locked." reaction: to change a single one, I had to change the engine and rebuild it. That is fine for a prototype and wrong for a game. From the start, my plan was that C++ owns the *systems* (rendering, physics, doors, audio) and C# owns the *gameplay*. This was the day I made that real.

## Why two languages

> **Theory: Why C# for gameplay and C++ for the engine.** An engine's hot loops, such as drawing, collision and animation, need tight control over memory and speed, which is what C++ gives. Gameplay is different. It is a thousand small decisions ("when the player walks in here, dim these lamps and play that sound") that change daily. It needs short edit-compile-run cycles, safe code that cannot corrupt memory, and a language that designers, and AI agents, can write. C# is a good fit. It is fast enough, garbage collected, and has a good tooling story. The rule I follow is that C# calls engine APIs and never replaces engine systems.

I did not build a custom scripting language or virtual machine. That would be a project of its own, and the demo does not need it. I embedded an existing runtime instead.

## Hosting .NET from C++

C# code needs the .NET runtime to run it. Normally the runtime starts first, then runs your program. I needed the reverse: my C++ program starts first, and *it* starts the runtime inside itself.

> **Concept: Native hosting (hostfxr).** Microsoft ships a small C library with .NET called `hostfxr`, the "host resolver". A C++ program can load it, point it at a runtime configuration file ("I need .NET 8"), and ask it for the address of a function inside a C# assembly. The runtime loads in the same process and the C++ code gets back an ordinary function pointer it can call. It is the same mechanism the `dotnet` command uses to start an app, only with *your* program in the driver's seat.

In practice, the engine finds the installed .NET 8 runtime, loads `hostfxr` at run time (there is no link-time dependency, and no third-party code), and starts the runtime in about 50 ms. The .NET SDK is needed only to *build* scripts. If it is missing, the engine still builds and runs, just without scripts.

### The bridge

Once there is a C# function pointer, the two sides still need to exchange data. I kept this boring on purpose: a small, versioned table of plain C functions. The engine hands the C# side a table of function pointers (find an entity, set a light's intensity, play a sound, and so on), and calls into C# for the script events. Everything that crosses the boundary is numbers, handles and strings, so there is no marshalling layer in between. The version number lets either side refuse a mismatched build instead of crashing mysteriously.

Two design decisions matter for the user experience:

- **Reloading.** Scripts are loaded into the runtime in a way that can be *unloaded* and loaded again without restarting the engine, and the DLL on disk is never locked. So I can rebuild while the editor is running.
- **Errors.** An exception in a script stops that script only, never the game. The error goes to the Console.

## The script API

A script is a class that derives from `Script` in `Game/Scripts`. It can override `OnStart`, `OnUpdate`, `OnTriggerEnter`, `OnTriggerExit` and `OnInteract`. Here is a whole script, the one that makes the bedroom door rattle:

```csharp
public class LockedDoor : Script
{
    public string Message = "It's locked.";
    public float Shake = 0.018f;

    public override void OnInteract()
    {
        if (!Self.Door.IsLocked) return;
        Audio.PlayAt("door_rattle", Self.Position + new Vector3(0, 1, 0));
        Camera.Shake(Shake, 0.22f);
        Hud.ShowMessage(Message);
    }
}
```

The script's API covers what the demo needs: finding entities by name or tag and moving them, dimming or recolouring lights, opening, closing and locking doors, playing sounds, shaking or darkening the camera, showing HUD text, timers, `await`, and talking to another entity's script. The public fields of a script (numbers, text, true/false, vectors, colours and entity references) are saved in the scene and edited in the Inspector.

## The demo's scare, rewritten

I moved the three pieces of hard-wired gameplay into scripts.

- **`LightFlicker`** is on all twelve lamps. Most burn steady and cost nothing. Two stutter now and then, one lightly and one more often, and other scripts can make any of them gutter.
- **`HallwayScare`** is on the trigger in front of the closet. When you walk in, the lamps near you gutter, the nearest one buzzes, something knocks on the wall behind you, the view jolts and the picture darkens for 2.2 seconds.
- **`LockedDoor`** is on the bedroom door: the handle rattles, the view jerks and the HUD says "It's locked.".

I deleted the C++ versions. Without scripts, the engine adds no scare, sound, shake or message of its own. As a side effect, the old C++ scare only ever worked in the straight test corridor, so the real demo had no working scare until now.

![The scripted scare](/images/2026-10-01-csharp-scripting/scare-scripted.jpg "During the scare (left, the lamps guttering and the picture darkened) and after (right).")

One visible change that I kept on purpose: the lamps got brighter. The old C++ flicker ran every frame, even with nothing flickering, and quietly lit the lamps at an older, dimmer value than the editor and all my look tuning used. With the flicker gone, the game matches the editor. The lamp pools are wider, and auto-exposure pulls the rest of the frame down a little.

## Authoring in the editor

A language is not much use if you have to leave the editor to use it.

![The Inspector on the closet trigger](/images/2026-10-01-csharp-scripting/inspector-script-scare.jpg "A Script component on the closet trigger: pick a class, and each public field gets a proper control.")

- **The Inspector** shows a Script component's class as a picker over the built scripts, and each field as a typed control: a drag for numbers, a checkbox, x/y/z, a colour picker, and an entity picker. A value you have changed has a reset button back to the script's default. A value that does not fit its field is flagged.

![A lamp's script, with reset buttons on the changed fields](/images/2026-10-01-csharp-scripting/inspector-script-lamp.jpg "One lamp's LightFlicker. The values changed on this lamp have reset buttons; the default one does not.")

- **Create C# Script** writes a new script from a template, attaches it and opens it in my code editor.
- **Saving a `.cs` file rebuilds in the background in about 2 seconds.** Errors show in the Console, where a click opens the file, and in the status bar. Play waits until they are fixed. A good build reloads the scripts and the Inspector straight away.

![A build error in the Console](/images/2026-10-01-csharp-scripting/editor-build-error.jpg "A missing semicolon: the Console row, Scripts: 1 error in the status bar, and Play refused.")

- **AI agents** get three tools through MCP: list scripts, create a script (from source they write, or the template), and build, which returns each error with its file and line. So an agent can write a gameplay script, see the compiler error, fix it, and rebuild, all in a loop.

## A review, and seventeen bugs

Before documenting any of it, I had three separate reviews go through the work: the C#/.NET boundary, the game side and the editor side. I checked each finding against the code myself. Seventeen were real bugs. The worst ones:

- **Saving could break the scene file.** A Script component with no class yet saved a scene that the loader then refused, and the save had already overwritten the good file. Such scripts now load, and every save writes and checks a copy before replacing the scene.
- **A timer could freeze the game.** A timer that re-armed itself with a delay shorter than a frame looped forever inside one update. Timers now count from the next frame.
- **Play was blocked for good without the .NET SDK.** A build that could not even start counted as "scripts have errors". Now only a build that ran and failed blocks Play.
- **The engine undid a key door.** A script that unlocked and opened a door from `OnInteract` had the engine's own toggle shut it again. Now the door reacts first and the script second.

## What it cost, and what is left

Script cost is small: 14 scripts take 0.007–0.03 ms a frame in a Debug build. GPU time did not change, between 0% and minus 1.5% per benchmark pose, and the benchmark runs without scripts anyway. The test count rose to 70 passing, including a test that does a real `dotnet build` of a script with a missing semicolon, checks that the error appears at the right line, and then builds the fixed version.

What I know is still limited:

- `LightFlicker` remembers a lamp's brightness from the start, so another script's change to that lamp is lost at its next flicker.
- A reload stalls the editor for about 45 ms in a Debug build.
- The script API has no scene loading, input or animation yet.
- The baked bounce light cannot yet follow a lamp that a script switches off. That needs one bake layer per lamp.

Next up is audio. The scripts already ask for sounds by name, and the next step is to make those names play real, positioned sounds.
