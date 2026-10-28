---
title: Hosting the .NET runtime to script gameplay in C#
date: 2026-10-01
order: 1
summary: How the engine hosts .NET from C++ with hostfxr, crosses the boundary with function pointers, reloads scripts, and moves the hallway gameplay to C#.
tags: scripting, gameplay
cover: /images/2026-10-01-csharp-scripting/scare-scripted.jpg
---

Until this milestone every piece of gameplay in the hallway was hard-wired C++ inside the game session: the scare, the lamp flicker and the "It's locked." reaction. Changing any of them meant changing the engine and rebuilding it. That is acceptable for a prototype, but my plan from the start was that C++ owns the systems (rendering, physics, doors, audio) and C# owns the gameplay. Milestone 4 makes that split real.

## Why two languages

Engine hot loops such as drawing, collision and animation need control over memory layout and timing, which C++ gives. Gameplay is a large number of small decisions that change often: when the player walks in here, dim these lamps and play that sound. It needs a short edit-compile-run loop, code that cannot corrupt memory, and a language that is easy to write and to generate. C# is fast enough, garbage collected and has solid tooling. My rule is that C# calls engine APIs and never replaces engine systems.

I did not write a scripting language or a virtual machine. That is a project of its own and the demo does not need one. I embedded the .NET runtime that is already installed.

## Hosting .NET from C++

> **Background: How a .NET program starts, and how a native program can start it instead.** Normally an executable called `dotnet` or an app host starts first. It uses a small library, `hostfxr` (the host resolver), to find a runtime that satisfies the app's `runtimeconfig.json`, loads it, and then runs the managed `Main`. `hostfxr` is a plain C library with a documented, stable interface, and any native program can use it. The program loads `hostfxr`, calls `hostfxr_initialize_for_runtime_config` with a runtime configuration file, then calls `hostfxr_get_runtime_delegate` to obtain a function that loads an assembly and returns a pointer to one of its static methods. The managed code runs in the native process, and the native code gets back a plain function pointer that it can call like any C function.

My `DotNetHost` does exactly that:

1. Look for an installation in `DOTNET_ROOT`, in the registry's install location and in `Program Files\dotnet`.
2. In `host\fxr` pick the highest version that is at least 8, and load its `hostfxr.dll` with `LoadLibrary`. The engine has no link-time dependency on .NET and no third-party code.
3. Resolve `hostfxr_initialize_for_runtime_config`, `hostfxr_get_runtime_delegate` and `hostfxr_close`, and initialise with `CC.Engine.runtimeconfig.json`. A result of 0, 1 or 2 is usable (started, already running, or running with other properties). Errors that `hostfxr` reports are collected through an error-writer callback so the log says what failed.
4. Ask for the `load_assembly_and_get_function_pointer` delegate. For each entry point the engine passes the assembly path, the type name and the method name, with the special delegate type that asks for a method marked `[UnmanagedCallersOnly]`, and gets back a function pointer.

The runtime starts in about 50 ms. The .NET 8 SDK is needed only to build scripts. If neither the runtime nor the managed assembly is found, the engine logs that scripting is off and carries on without it.

## The boundary: function-pointer tables

> **Background: Crossing between native and managed code.** The common route from C# to C is P/Invoke, where the runtime generates a *marshalling* stub that converts arguments (strings, arrays, structures) between the two memory layouts, and takes care of exceptions. That convenience costs time and allocations on every call, and it hides what happens at the boundary. A cheaper and more explicit approach uses only *blittable* types, which have the same layout in both languages (integers, floats, pointers), and passes functions as raw pointers. C# can call a native function pointer directly, and native code can call a managed method marked `[UnmanagedCallersOnly]`. Nothing is converted, so the boundary carries only what I decide to put on it.

The boundary has two directions, and both are tables of function pointers.

![The engine hosting the .NET runtime](/images/2026-10-01-csharp-scripting/hosting.svg "One process holds both sides. They share only function pointers and plain values.")

**C++ to C#.** The managed assembly `CC.Engine` has a class `Host` whose methods are all `[UnmanagedCallersOnly]` with blittable arguments: `Initialize`, `LoadScripts`, `UnloadScripts`, `CreateInstance`, `DestroyInstance`, `Dispatch`, `UpdateAll`, `DescribeScripts` and a few more. The engine resolves each one once through `GetEntryPoint` and keeps the pointer.

**C# to C++.** The engine fills a `NativeApi` structure with function pointers (find an entity, set a light's intensity, play a sound, shake the camera, show a HUD message and so on) and passes its address to `Host.Initialize`. The structure is mirrored field for field in C#, where each field is an `unmanaged` function pointer type. Strings cross as a UTF-16 pointer and a length. Entities are integer ids, and 0 means none.

```csharp
public delegate* unmanaged<uint, float, int> setLightIntensity;
```

Three rules keep the boundary safe:

- **Versioning.** The structure begins with a version and its own size. The managed side refuses a table whose version or size it does not recognise, so a mismatched build fails to start and does not crash at the first call.
- **No exception crosses.** An exception that escapes an `[UnmanagedCallersOnly]` method ends the process. Every entry point catches everything, logs it and returns a status code. On the C++ side, every callback that allocates is wrapped in a guard that catches C++ exceptions and returns a safe fallback, because an exception unwinding through managed frames would also end the process.
- **Every callback accepts a stale id.** A script can hold an entity id after the entity is gone, so each function must be safe to call with an id that is not, or no longer, an entity.

## Loading, unloading and reloading scripts

I want to rebuild scripts while the editor is open and see the change in a couple of seconds, without restarting the engine.

> **Background: Collectible load contexts.** The .NET runtime cannot unload a single assembly from the default context. It can unload a whole `AssemblyLoadContext` that was created as *collectible*. Unloading is cooperative: after `Unload()` is called, the context's assemblies are freed by the garbage collector once nothing references any of their types, instances or delegates. The runtime does not report when that happens, but a `WeakReference` to the context becomes dead when it has. Loading an assembly from bytes in memory instead of from a path also avoids locking the file on disk, so the next build can overwrite it.

In `ScriptRegistry` the scripts assembly is loaded into its own collectible context. The DLL and its symbols are read into memory and loaded from a stream, so the compiler can always write a new file. The context hands scripts the host's own `CC.Engine` assembly when they ask for it, so `Script` and `Entity` are the types that the host knows, and resolves everything else from the framework. To reload, the registry destroys every instance and timer, clears its type table, unloads the context and keeps a weak reference to it. `UnloadScripts` then runs the garbage collector up to eight times and reports whether the old assembly has actually been released, so the engine can tell a clean reload from a leak. A reload stalls the editor for about 45 ms in a Debug build.

Two details make scripts behave inside a single-threaded engine. First, `await` in a script resumes on the engine's thread at the next update, through a synchronization context that queues continuations, because the engine is not thread-safe. Each play session gets a fresh context, so continuations from a session that ended are dropped and not run in the next one. Second, an exception in a script stops only that script. `Dispatch` returns 1 when it ran, 0 when the script is gone or stopped, and -1 when it threw, and the error goes to the Console.

## A script

A script is a class that derives from `Script` in `Game/Scripts`. It can override `OnStart`, `OnUpdate`, `OnTriggerEnter`, `OnTriggerExit` and `OnInteract`. This is the script that makes the bedroom door rattle:

```csharp
public class LockedDoor : Script
{
    public string Message = "It's locked.";
    public float RattleVolume = 0.95f;
    public float Shake = 0.018f;
    public float ShakeSeconds = 0.22f;

    public override void OnInteract()
    {
        if (!Self.Door.IsLocked) return;
        Audio.PlayAt("door_rattle", Self.Position + new Vector3(0.0f, 1.0f, 0.0f), RattleVolume);
        Camera.Shake(Shake, ShakeSeconds);
        if (Message.Length > 0) Hud.ShowMessage(Message);
    }
}
```

The API covers what the demo needs. A script can find entities by name or tag and move or turn them, dim or recolour lights, open, close, lock and unlock doors, switch interactables off, play sounds by name, shake or darken the camera, show HUD text, set timers, `await`, and call another entity's script with `GetScript<T>`. Its public fields (numbers, text, true/false, vectors, colours and entity references) are saved with the scene as text and edited in the Inspector. The managed side lists a class's public, writable fields of those types by reflection, and when the engine creates an instance it passes the saved values as a JSON object of strings.

## The hallway's gameplay moves to C#

![The scripted scare](/images/2026-10-01-csharp-scripting/scare-scripted.jpg "During the scare (left, the lamps guttering and the picture darkened) and after (right).")

- **`LightFlicker`** is on all twelve lamps. Most burn steady and cost nothing. Two stutter now and then, one lightly and one more often, and other scripts can make any of them gutter.
- **`HallwayScare`** is on the trigger in front of the closet. When the player walks in, the lamps near them gutter, the nearest one buzzes, something knocks on the wall behind them, the view jolts and the picture darkens for 2.2 seconds.
- **`LockedDoor`** is on the bedroom door. The engine still jolts the leaf against its latch, and the script adds the rattle, the camera jerk and the "It's locked." message.

I deleted the C++ versions, so without scripts the engine adds no scare, sound, shake or message. The old C++ scare only ever ran in the straight test corridor, so the real demo had no working scare until now.

There was one visible change that I chose to keep: the lamps got brighter. The old C++ flicker ran every frame, even with nothing flickering, and lit the lamps at their `baseIntensity` (2.1 to 2.5) while the editor and all my look tuning used `intensity` (4.8). With the flicker gone, the game matches the editor. The lamp pools are wider and auto-exposure pulls the rest of the frame down a little.

## Authoring from the editor and from MCP

A language is not much use if I have to leave the editor to use it.

![The Inspector on the closet trigger](/images/2026-10-01-csharp-scripting/inspector-script-scare.jpg "A Script component on the closet trigger: a class picker over the built scripts, and each public field as a typed control.")

The Inspector shows a Script component's class as a picker over the built scripts and each field as a typed control: a drag for numbers, a checkbox, x/y/z, a colour picker and an entity picker. A value I have changed has a reset button back to the script's default. A value that does not fit its field is flagged.

![A lamp's script, with reset buttons on the changed fields](/images/2026-10-01-csharp-scripting/inspector-script-lamp.jpg "One lamp's LightFlicker. The three values changed on this lamp have reset buttons and the default one does not.")

Create C# Script writes a new class from a template, attaches it and opens it in my code editor. Saving a `.cs` file rebuilds the scripts in the background in about 2 seconds. Errors appear in the Console, where a click opens the file, and in the status bar, and Play waits until they are fixed. A good build reloads the scripts and the Inspector straight away, or when Play stops.

![A build error in the Console](/images/2026-10-01-csharp-scripting/editor-build-error.jpg "A missing semicolon: the Console row, 'Scripts: 1 error' in the status bar, and Play refused.")

![Fields added to a script appear in the Inspector](/images/2026-10-01-csharp-scripting/editor-reloaded-fields.jpg "Fields added while the editor runs show up in the Inspector about two seconds after saving.")

I also added three MCP tools, the same ones an agent uses to drive the editor: list the scripts, create a script from source or from the template, and build, which returns each compiler error with its file and line. An agent can therefore write a gameplay script, read the error, fix it and rebuild in a loop. Validation flags a script whose class is not built, a value for a field the class does not have, and a value that does not read as its type.

## A review, and seventeen bugs

Before documenting any of this, I had three reviews go through the work: the C#/.NET boundary, the game side and the editor and MCP side. I checked every finding against the code myself, and seventeen were real bugs, each fixed with a test where one fits. The most important:

- **Saving could break the scene file.** A Script component with no class yet saved a scene that the loader refused, and the save had already overwritten the good file. Such scripts now load, and every save writes and verifies a copy before replacing the scene.
- **A timer could freeze the game.** A timer that re-armed itself with a delay shorter than a frame looped forever inside one update. Timers now count from the next frame, which also stops them from firing a frame early.
- **Play was blocked for good without the .NET SDK.** A build that could not start counted as "scripts have errors". Now only a build that ran and failed blocks Play.
- **The engine undid a key door.** A script that unlocked and opened a door from `OnInteract` had the engine's own toggle close it again. The door now reacts first and the script second.

Smaller fixes included a disabled interactable hiding the one behind it, children's colliders not following a script's move, builds that outlived the editor, and the lamp flicker rebuilding the whole render view every frame instead of updating the light in place.

## Results and limits

Script cost is small: 14 scripts take 0.007 to 0.03 ms per frame in a Debug build. GPU time is unchanged, between 0% and -1.5% per benchmark pose at 1440p, and the benchmark runs without scripts. The test suite has 70 tests, including `ScriptingTests`, which does a real `dotnet build` of a script with a missing semicolon, checks that the error appears at the right line and then builds the corrected version. In the game, the frame during the scare averages about 16% darker than the frame after it.

Known limits:

- `LightFlicker` remembers a lamp's brightness from the start, so another script's change to that lamp is lost at its next flicker.
- `Time.DeltaSeconds` in trigger and interact handlers is the previous frame's.
- The script API has no scene loading, input or animation yet.
- The baked bounce light cannot follow a lamp that a script switches off. That needs one bake layer per lamp.

Audio is next. Scripts already ask for sounds by name, and the next step is to make those names play real, positioned sounds.
