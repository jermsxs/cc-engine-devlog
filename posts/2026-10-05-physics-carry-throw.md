---
title: Physics from scratch, and things you can throw
date: 2026-10-05
order: 1
summary: A rigid-body physics engine written from scratch, then picking up, carrying and throwing props with real weight, and a day of tuning tins, throws and shiny floors.
tags: physics, gameplay
cover: /images/2026-10-05-physics-carry-throw/ball-throw.jpg
---

Until now nothing in the house moved unless a door swung. That is a problem for a horror game, where half the fun is things that fall, knock and get in the way. So the next phase of my realism plan started with physics, and as with everything in this engine, I wrote it from scratch rather than pulling in a library. Over two days it grew from "things fall over" to picking a chair up, throwing a ball down the corridor, and tins that roll.

## A physics engine in five pieces

> **Concept: Rigid bodies.** A rigid body is an object that never bends: a crate, a tin, a chair. The engine tracks its position, rotation, and how fast it moves and spins. Each step of the simulation does four jobs: apply forces (gravity), find what touches what, work out the forces that stop things sinking into each other, and move everything a little. Repeat 60 times a second.

**Finding what touches what.** Testing every object against every other is far too slow. A tree of bounding boxes holds every collider and body, so only nearby things get tested. The player's queries (walking, triggers, the ray from the eye) use the same tree.

**Shapes.** Boxes, spheres, capsules, and convex hulls built from a prop's own mesh (a tin, a bottle, a mug). The hull builder keeps at most 32 points and merges flat areas into single faces, so a box stays six-sided and a tin has two flat ends.

**Contacts.** For each touching pair, the engine finds up to four contact points. Round shapes use their closest points; a round shape against a box uses GJK, a classic algorithm for the distance between two convex shapes; two boxes or hulls use the separating-axis test with face clipping.

> **Concept: Separating axis test.** Two convex shapes do not overlap if you can find a line such that, projected onto it, their shadows do not overlap. For boxes you only need to try a small set of candidate lines (the face normals and edge cross products). The line where they overlap the *least* tells you which way to push them apart.

**The solver.** Sixty steps a second, each split into substeps, using the "soft step" method from Box2D v3 adapted to 3D. It handles friction, rolling resistance (so a ball slows and stops) and bounce. Contacts are also created slightly *before* things touch, based on speed, so a fast small object cannot skip through a thin wall. I tested that with a 30 m/s object against a 4 cm wall.

**Sleep.** Groups of touching bodies that have been still for half a second fall asleep and cost nothing until something moving touches them. This is what makes the house cost nothing when nothing is moving.

Ten physics materials (wood, metal, rubber, glass, fabric and so on) set friction, bounce, rolling drag and density. I authored seven props in Python, like the rest of the content: a rubber ball, a lidded pine crate, a food tin, a wine bottle, a book, a mug and a carton. Each has a real mass, not one from its material's density: a 20 cm ball of solid rubber would weigh 4.6 kg, a real one 0.35 kg.

In the game, the player walks into props under 15 kg and pushes them with a limited force, as a person would, and doors push props out of their way. If a prop will not give, the door waits, still pressing, and swings on once it can. Scripts can push bodies and cast rays, so a script can let you kick the ball with E.

![The crate shoved: before, during and settled](/images/2026-10-05-physics-carry-throw/crate-shove.jpg "Looking at the crate and pressing E: before, just after, and settled. Two tins topple off and roll on their sides; one stays on the lid.")

Problems found on the way make good stories:

- A 400 kg crate still crept away from a door that should not have moved it. A held door stopped counting as pushing, so it shoved the crate out of the overlap with no force limit. And on first touch the bounce pass gave the crate 1.1 m/s because pushes were not capped there. A held door now still pushes with its cap, and pushes never bounce.
- The tin's hull would not build. The centre of its lathed end tied with the rim as its lowest point and broke the end face. Faces are now outlined by their own 2D convex hull, so such points drop out.
- Tins stacked on the crate floated above its open top, where the box collider is. The crate now has a boarded lid.
- In a test pile, one "box" kept rolling for 17 m. It was a ball (my shape code 0 means sphere), rolling exactly as far as a rubber ball should on a hard floor.

A 300-box heap with all bodies awake and 2,620 contact points takes 2.8 ms a step on one core. The house's 16 props asleep cost nothing measurable.

## Pick it up, feel the weight

I wanted to grab things and throw them, mainly to test the physics honestly: a ball's bounce, and a chair that should feel heavier than a ball.

Hold the left mouse button on a loose prop to pick it up. It is held where you picked it up and turns as you turn. Crucially, the hands are not a teleport: a spring inside the solver pulls the prop toward them with at most 160 N. A ball follows the view at once; a 6 kg chair sags and lags a little; anything over about 16 kg (more than 160 N of weight) cannot be lifted, only dragged. Pull on the 35 kg table and it scrapes toward you, with a bottle and a book riding on top. If you snag it on furniture or walk away, it slips out of your hands.

![The ball picked up and thrown](/images/2026-10-05-physics-carry-throw/ball-throw.jpg "Grabbing the ball, carrying it (held closer, so it looks bigger) and throwing it: a few frames later it is bouncing far down the corridor.")

![Pulling on the heavy dining table](/images/2026-10-05-physics-carry-throw/table-drag.jpg "Trying to pick up the 35 kg table: it only drags toward the player, and the bottle, mug and book ride along.")

For furniture to move, a rigid body can now be a *compound*: a chair is its seat, four legs and a back, each a box collider on a child entity, so a ball can roll under the seat between the legs. The house's eight chairs (6 kg) and two dining tables (35 kg) are compounds, and three armchairs are 25 kg padded boxes you can shove but not lift.

### Heavy on light

Tests found a real solver weakness. A 50 kg box on a 0.5 kg box sank 3.4 cm into it. With soft contacts, a resting contact is a spring as stiff as its lighter body, so a light body under a heavy load gives way. Contacts now read how much load they carry from last step's impulses and stiffen to keep the overlap near a 5 mm slop. But there is a stability limit on stiffness (a quarter of the substep rate), so the solver now runs 8 substeps per step instead of 4. At 4 the stack still sank 7 mm into each contact and kept jittering; at 8 it settles at 5 mm and falls asleep. That doubled the cost of the heap, from 2.3 ms to 3.0 ms a step, split about evenly between finding contacts and solving.

Rolling resistance now only applies where things actually roll; a box lying on a face had been paying for it on every contact.

## Throw it as hard as you swing it

I asked for three fixes before the rest of the work. The floors had gone shiny again. Every throw had the same strength, however I moved the mouse. And light props did not act like the real thing.

**A throw is as hard as the swing.** While you carry something, it moves with your view, so moving the mouse swings it. On release the prop keeps the fastest it was moving in your hands over the last tenth of a second, and goes along the view with most of that speed again. Let go with the mouse still and it just drops. A gentle swing tosses the ball at 1 to 2 m/s; a hard flick throws it at up to 12 m/s. Weight comes free: the hands pull with at most 160 N, so a 6 kg chair lags behind any swing and is never flung.

**Tins and bottles roll.** I measured against reality first. The ball was already right: dropped from 1 m it bounced 0.61 m, close to a real rubber ball's 0.56 to 0.72 m. The tin was wrong: on its side at 1 m/s, it stopped dead after 35 cm. Why? Its collision shape was a 16-sided prism, and a prism rolling over its flats loses about a tenth of its energy at every flat. The engine now has a true cylinder shape: a slightly smaller cylinder rounded by up to 1 cm at its edges, so it rolls on a real circle. The same push now rolls the tin about 4 m, as a real one would on a wooden floor. Tins are cylinders, a bottle is a cylinder with a capsule for its neck, and a mug a cylinder with a box for its handle. Six tins stacked in a pyramid stand and fall asleep.

![A tin knocked off the crate rolling away](/images/2026-10-05-physics-carry-throw/tin-roll.jpg "The top tin taken off the crate and tossed sideways: it lands on its side and rolls away across the floor and out of view, while the other two keep standing.")

**The softer surface decides.** A pair of materials used the larger bounce and the larger rolling drag, so a rubber ball bounced off an armchair as off the floor, and a steel tin dragged on wood like a rubber ball. Each material now has a stiffness (roughly its Young's modulus), and in an impact the softer surface takes most of the squeeze, so its bounce and drag count most. The ball keeps its bounce on wood but bounces about a tenth as high off an armchair, and a tin rolls freely on wood.

**Air.** Light, large things slow down in flight: drag grows with speed squared and the area the shape shows the air. A 0.35 kg ball thrown at 9 m/s loses about 2 m/s every second; a heavy crate loses nothing measurable.

**Legs push low.** Fixing the materials showed a crate tipping over when walked into. The player is a capsule, and its round foot met a knee-high crate at the top edge. The push now acts no higher than the prop's centre of mass, as legs would.

## Floors that stop shining

The corridor parquet's finish had a roughness of about 0.2, like a lacquer: it mirrored the lamps, and the flashlight left a white hotspot on it. It is now worn, unwaxed wood (about 0.48), and the bedroom boards went from 0.54 to 0.76. The grain, boards and scratches still show; the glare does not.

![The hallway floor with a glossy finish and a matte one](/images/2026-10-05-physics-carry-throw/floor-hallway.jpg "The hallway before (left) and after (right): the lamp's streak down the parquet is gone.")

## Where it ended

The physics changes cost nothing standing still, since bodies sleep until touched, and all benchmark poses stayed within noise (about -2% to +2% at frames of 3.6 ms). All the tests I added pass: cylinders that roll 3 to 8 m where hulls stopped within 0.6 m, a tin that stands on its base and sleeps, a ball knocking a tin, air drag, the material pairs, and the game-level checks that a still release drops the ball and a flick throws it 8 m/s down the hall.

Still to come in the player-feel work: footsteps by surface (the impact events and materials are ready), crouch, lean and inspecting objects, plus impact sounds. Cylinders could also stand in for more of the house, like the vase and lamp bases.
