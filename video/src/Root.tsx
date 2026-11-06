import "./index.css";
import { Composition } from "remotion";
import { Main, TOTAL } from "./Main";

export const RemotionRoot: React.FC = () => {
  return <Composition id="BoundFilm" component={Main} durationInFrames={TOTAL} fps={30} width={1920} height={1080} />;
};
