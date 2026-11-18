import { LoadingScreen } from './ui/LoadingScreen.ts';

async function bootstrap(): Promise<void> {
  const loadingScreen = new LoadingScreen();

  try {
    await loadingScreen.advance(4);
    const { startGameApp } = await import('./GameApp.ts');
    await startGameApp(loadingScreen);
  } catch (err) {
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'Unable to initialize graphics in this browser.';
    loadingScreen.showError(message);
  }
}

void bootstrap();
