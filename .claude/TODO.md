# TODO

## Now (Week 1 — skeleton, mock data)
- [X] Create screen wrapper component, "ScreenWrapper.tsx", that will be used as the root component of every screen.
    Give it:
    - scrollview component
    - keyboard avoiding view component
    - spread children from props into the inner most JSX
- [X] Apply ScreenWraper to index.tsx
- [ ] Create another page in the expo router by adding a file "location[id].tsx" that will 
- [ ] Create a pressable card like UI item (soft rounded borders with some nice shadow) that will be used in a Flatlist on the index page. It will display the data found in locations under mock-data dir
- [ ] Add flatlist to index.tsx to use said card with location data piped in.  On press they will lead to another page. 