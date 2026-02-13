export type AuthStackParamList = {
  Auth: undefined;
};

export type ProjectsStackParamList = {
  ProjectsHome: undefined;
  ProjectDetail: { projectName: string };
};

export type MainTabParamList = {
  ProjectsTab: undefined;
  ActivityTab: undefined;
  AnimeTab: undefined;
  SettingsTab: undefined;
};

export type RootStackParamList = {
  AuthFlow: undefined;
  AppFlow: undefined;
  AdminPanel: undefined;
};
