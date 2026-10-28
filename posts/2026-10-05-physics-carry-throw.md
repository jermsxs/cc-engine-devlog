---
title: A rigid-body physics engine, and carrying and throwing props
date: 2026-10-05
order: 1
summary: I wrote a rigid-body physics engine from scratch, added a spring-driven grab for carrying props, then tuned throws, rolling tins and floor finish over a second day.
tags: physics, gameplay, performance
cover: /images/2026-10-05-physics-carry-throw/ball-throw.jpg
---

Until now nothing in the house moved unless a door swung. A horror game needs things that fall, knock and get in the way, so the next phase of my realism plan began with physics. As with the rest of the engine, I wrote it from scratch. Over two days it went from objects falling over to picking up a chair, throwing a ball down the corridor and tins that roll.

## Simulating a rigid body

> **Background: rigid bodies.** A rigid body is an object that never deforms, such as a crate, a tin or a chair. Its state is a position and rotation, a linear velocity and an angular velocity. Its mass says how hard it is to accelerate. Its inertia tensor, a 3 by 3 matrix, says how hard it is to spin about each axis, and it depends on how the mass is spread through the shape. A simulation advances this state in small fixed steps: apply forces such as gravity to the velocities, change velocities to stop bodies sinking into each other, then move each body by its velocity.

Updating the velocity first and then moving by it is called semi-implicit Euler integration, and it is more stable than moving first. Damping uses an implicit form as well: `v = v / (1 + h * damping)`, which cannot overshoot however large `h` is.

The engine steps 60 times a second with a fixed step, so the simulation is the same on a fast or slow computer, and the renderer interpolates between the last two steps. A slow frame runs at most four steps and drops the rest of the time, so the game slows down and does not spiral. Each step is split into 8 substeps, which I explain below.

![One physics step](/images/2026-10-05-physics-carry-throw/step-loop.svg "The order of one step. Contacts are found once; the six stages in the dashed box repeat for each of the eight substeps.")

## Finding what touches what

Testing every body against every other is quadratic. The broad phase finds pairs that might touch using only bounding boxes. Mine is a tree of boxes: each leaf holds one collider's box, and each inner node holds a box that contains its children, so a query descends only into nodes whose boxes overlap it. A body's leaf box is enlarged by a margin and by the distance the body will move this step, so the leaf changes only when the body leaves that larger box. The player's queries, such as walking, triggers and the ray from the eye, use the same tree.

The second phase, the narrow phase, finds the exact contact between each candidate pair. My shapes are boxes, spheres, capsules, compounds of these, and convex hulls built from a prop's own mesh. The hull builder keeps at most 32 points and merges coplanar faces, so a box stays six-sided and a tin has two flat ends.

> **Background: GJK and the separating axis test.** Two convex shapes do not overlap if some line exists such that their projections onto it do not overlap. For two boxes there are only 15 candidate lines to try: the face normals of each box and the cross products of their edges. The line where the overlap is smallest gives the contact normal, the direction to push the shapes apart. The contact points come from clipping one box's face against the other's side planes. The GJK algorithm finds the distance between two convex shapes by searching their difference shape for the point nearest the origin, and I use it for a round shape against a box or hull.

A pair produces a manifold: a normal and up to four contact points, each with a depth. Four points are enough to rest a box stably.

## Contacts as constraints

Resting contact is a constraint, and I solve it with impulses.

> **Background: impulses.** An impulse is a force applied for a short time, in newton-seconds. It changes velocity instantly: `dv = J / m`. Applied at a point `r` away from the centre of mass, it also changes the angular velocity by `I^-1 (r x J)`. To keep two bodies from approaching each other at a contact, I want the relative velocity along the normal to be zero or positive after the impulse. The impulse that does this is `-v_n / K`, where `v_n` is the current approach speed and `K = 1/mA + 1/mB + (rA x n)·I_A^-1 (rA x n) + (rB x n)·I_B^-1 (rB x n)` is the contact's effective inverse mass, combining both masses and how the contact's offset couples into rotation.

A contact can push but never pull, so the impulse accumulated at a point is kept at zero or more. Contacts are solved one at a time, which is called sequential impulses, and because fixing one disturbs the others the solver repeats. To start close to the answer, each contact first receives the impulses it ended the previous step with, matched by a contact key. This warm starting is what lets a stack of boxes settle and stay still.

**Friction.** Coulomb friction limits the sideways impulse at a point to `mu` times its normal impulse. I solve it along two tangent directions and, if the pair's total exceeds the limit, scale it back to the limit's circle. **Rolling resistance** is a torque limited in the same way, applied only to contacts of one or two points, such as a ball or a tin on its side. A face resting on three points cannot roll, so it pays nothing.

**Restitution.** Bounce is added after the solve. If a point was approaching faster than 1 m/s, its velocity along the normal is set to `-e` times the approach speed. Slower contacts do not bounce, which stops resting contacts from jittering.

**Soft contacts.** Bodies that overlap have to be pushed apart, and a hard correction adds energy and makes them pop. I use the soft step method from Box2D version 3, which I adapted to 3D. A contact acts as a damped spring with a stiffness of 30 Hz and a damping ratio of 10. Solving the spring implicitly gives three numbers, a bias rate, a mass scale and an impulse scale, which keep the correction stable at any step size. Each substep solves with the bias, moves the bodies, and then solves again without the bias to remove the energy it added. Overlap up to a 5 mm slop is tolerated, and overlaps are pushed out at no more than 3 m/s.

**Speculative contacts.** Contacts are created when two shapes are within 2 cm, and not only when they touch. A contact whose gap is positive can only close the gap: the allowed approach speed is `gap / h`. A fast small object therefore stops at a thin wall and does not skip through it between two steps. I tested this with a 30 m/s object against a 4 cm wall.

## Sleeping

A pile of boxes at rest should cost nothing. Bodies joined by touching contacts form an island, found with a union-find structure. A body is slow when it moves under 0.05 m/s and spins under 0.08 rad/s, and an island falls asleep when every body in it has been slow for half a second. A sleeping body is skipped by the solver and stays in the tree until something awake touches it. This is why the house costs nothing while nothing moves.

## The props, the player and the doors

Ten physics materials, such as wood, metal, rubber, glass and fabric, set friction, bounce, rolling resistance and density. I authored seven props in Python like the rest of the content: a rubber ball, a lidded pine crate, a food tin, a wine bottle, a book, a mug and a carton. Each has an explicit mass, because a solid rubber ball 20 cm across would weigh 4.6 kg and a real one weighs 0.35 kg.

The player and the doors are not bodies in the solver. The player's capsule moves at its own velocity and pushes bodies through a contact whose impulse is capped at `force * dt`. I chose 200 N as a person's push, so a prop above about 15 kg stops the player. Doors push with at most 400 N, and if a prop does not give, the door waits, still pressing, and swings on once it can.

![The crate shoved: before, during and settled](/images/2026-10-05-physics-carry-throw/crate-shove.jpg "Looking at the crate and pressing E: before, just after, and settled. Two tins topple off and roll on their sides; one stays on the lid.")

I found two bugs on the way.

- A 400 kg crate still crept away from a door that should not have moved it. A held door stopped counting as pushing, so it shoved the crate out of the overlap with no force limit. And on first touch the bounce pass gave it 1.1 m/s because pushes were not capped there. A held door now still pushes with its cap, and pushes never bounce.
- The tin's hull would not build. The centre of its lathed end tied with the rim as the lowest point and broke the end face. Faces are now outlined by their own 2D convex hull, so such points drop out.

## Heavy on light

Tests found a weakness. A 50 kg box on a 0.5 kg box sank 3.4 cm into it. A soft contact is a spring whose stiffness comes from its frequency and the lighter body's mass, so a 490 N load compressed a spring sized for 0.5 kg. Contacts now read their load from last step's impulses and raise their frequency until the overlap would be about the 5 mm slop. The frequency has a stable ceiling, a quarter of the substep rate, so I raised the substeps from 4 to 8. With 4 the stack still sank 7 mm into each contact and kept jittering, and with 8 it settles at 5 mm and falls asleep. A 300-box heap went from 2.3 ms to 3.0 ms a step, split about evenly between finding contacts and solving.

## Carrying

> **Background: holding an object with a spring.** The simplest way to hold a body is to set its position to the hand's each frame. The object then has unlimited strength: it passes through walls, shoves anything aside and weighs nothing. A better way is a constraint that pulls the body toward a target. A spring pulls with a force proportional to the distance from the target, and a damper opposes the velocity. With a damping ratio of 1 the spring is critically damped, so the body reaches the target as fast as it can without overshooting. A cap on the force then makes weight matter, since a hand that can pull with 160 N cannot hold a 20 kg object, which weighs 196 N.

The grab is one more constraint in the contact solver, in the order shown in the diagram. The target is a point in front of the camera, at the distance where the prop was picked up, and the target rotation turns with the player. The spring runs at 7 Hz with a damping ratio of 1, in the same implicit soft form as the contacts. It asks for a velocity that closes the error, applies the impulse that gives it, and clamps the impulse to `maxForce * h`, 160 N, and the torque to 12 N m. The target velocity is the hand's own velocity, so a walking player does not drag the prop behind.

Because the grab is only a force, everything else still applies. A held prop collides with walls and furniture and cannot be pushed through them. A ball follows the view at once. A 6 kg chair, which weighs 59 N, uses over a third of the hand's strength, so it sags and lags behind quick turns. Anything over about 16 kg cannot be lifted, only dragged, and the 35 kg table scrapes toward you with the bottle, mug and book riding on top. A prop more than 0.9 m from the hand for half a second, because it caught on furniture or the player walked away, slips out of the hands.

![The ball picked up and thrown](/images/2026-10-05-physics-carry-throw/ball-throw.jpg "Grabbing the ball, carrying it (held closer, so it looks bigger) and throwing it: a few frames later it is bouncing far down the corridor.")

![Carrying a dining chair](/images/2026-10-05-physics-carry-throw/chair-carry.jpg "A dining chair: looked at, lifted toward the hands and released, then thrown at 1.2 m/s.")

![Pulling on the heavy dining table](/images/2026-10-05-physics-carry-throw/table-drag.jpg "Trying to pick up the 35 kg table: it only drags toward the player, and the bottle, mug and book ride along.")

For furniture to move, a body can now be a compound of several collider shapes. A chair is a seat, four legs and a back, each a box on a child entity, so a ball can roll under the seat between the legs. Each pair of parts gets its own contact manifold and warm-start key. The house's eight chairs weigh 6 kg and its two dining tables 35 kg.

## Throwing as hard as I swing

My first throw was a fixed impulse of at most 7 N s and 9 m/s, so the ball left at 9 m/s however I moved the mouse. The next day I made a throw as hard as the swing. A carried prop moves with the view, so moving the mouse swings it. The game records the prop's velocity relative to the player over the last tenth of a second, and on release the prop keeps the fastest of those velocities plus 0.8 of its speed along the view, so a flick upward lobs it. The result is limited to `min(12 m/s, 7 N s / mass)`. Letting go with the mouse still drops the prop. A gentle swing tosses the ball at 1 to 2 m/s and a hard flick throws it at 12 m/s, while the impulse limit holds heavy things back: 1.2 m/s for the chair and 0.2 m/s for the table.

## Tins that roll, soft surfaces and air

Before changing anything I measured the ball and the tin against real ones. The ball was already right. Dropped from 1 m it bounced 0.61 m, and a real rubber ball bounces 0.56 to 0.72 m. A bounce height ratio is the square of the restitution, so that is about 0.78 against 0.8 in the material. The tin was wrong: pushed on its side at 1 m/s it stopped after 35 cm.

Its collision shape was a 16-sided prism. A prism rolling over its flats loses about a tenth of its energy at every flat, because each flat hits the floor like a small impact. The engine now has a real cylinder shape, a slightly smaller cylinder with edges rounded by up to 1 cm, so it rolls on a true circle. The same push now rolls the tin about 4 m, as a real one would on wood. A bottle is a cylinder with a capsule for its neck, and a mug is a cylinder with a box for its handle.

![A tin knocked off the crate rolling away](/images/2026-10-05-physics-carry-throw/tin-roll.jpg "The top tin taken off the crate and tossed sideways. It lands on its side and rolls away across the floor and out of view, while the other two keep standing.")

Three more changes came from the same measurements.

- **The softer surface decides.** A pair of materials took the larger bounce and the larger rolling drag, so a rubber ball bounced off an armchair as off the floor. Each material now has a stiffness, roughly its Young's modulus, and in an impact the softer surface takes most of the squeeze, so its bounce and drag count most. The ball keeps its bounce on wood but bounces about a tenth as high off an armchair, and a tin rolls freely on wood.
- **Air drag.** Drag force is `0.5 * density * Cd * area * v^2`. It slows light, large things in flight: a 0.35 kg ball thrown at 9 m/s loses about 2 m/s every second, and a heavy crate loses nothing measurable.
- **Legs push low.** Fixing the materials showed a crate tipping over when I walked into it. The player is a capsule, and its round foot met the knee-high crate at its top edge. The push now acts no higher than the prop's centre of mass.

## Floors that stop shining

The corridor parquet had a roughness of about 0.2, like a lacquer. Roughness sets how widely a surface spreads its reflection, and at 0.2 the lamps appeared as long streaks and the flashlight left a white hot spot. The floor is now worn, unwaxed wood at about 0.48, and the bedroom boards went from 0.54 to 0.76. The grain and scratches still show, and the glare does not.

![The hallway floor with a glossy finish and a matte one](/images/2026-10-05-physics-carry-throw/floor-hallway.jpg "The hallway before (left) and after (right). The lamp's streak down the parquet is gone.")

## Results

Bodies sleep until touched, so the physics costs nothing standing still, and every benchmark pose stayed within noise, about -2% to +2% at frames of 3.6 ms. A heap of 300 boxes, all awake with about 2,600 contact points, takes about 3 ms a step on one core. The new tests check that a cylinder rolls 3 to 8 m where the hull stopped within 0.6 m, that a still release drops the ball and that a flick throws it down the hall.

Still to do are footsteps by surface, crouching, leaning and inspecting objects, and then impact sounds, for which the engine already emits impact events.
