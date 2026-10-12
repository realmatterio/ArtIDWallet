# Local artwork overrides (not committed)

Anything you drop in this folder overrides the public-domain paintings at
runtime, on your machine only. The folder is gitignored, so nothing here is
committed, pushed, or shared.

Use the same filenames as the set it replaces:

    scream.jpg
    great-wave.jpg
    starry-night.jpg
    sunflowers.jpg

Delete a file and that piece falls back to the public-domain painting.

## What this is for

Showing a presentation with images you hold rights to, or that are fine for a
one-off internal demo, without putting them into version control. It is not a
way to ship unlicensed art: anything that goes into the product itself needs
clearing. For Warhol specifically, licensing runs through the Artists Rights
Society (ARS) on behalf of the Andy Warhol Foundation.

## A practical note

High-contrast images with large black areas scan badly behind a QR code - the
dark regions compete with the code's own modules. Flat, mid-to-light images
work best. The live badge under the slider tells you whether a given image
actually decodes, so check it after swapping anything in.
