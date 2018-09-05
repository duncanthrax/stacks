using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Data;
using System.Drawing;
using System.Text;
using System.Linq;
using System.Threading;
using System.Windows.Forms;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;

namespace StacksLauncher
{
    public partial class Form1 : Form
    {
        private NotifyIcon sysTrayIcon;
        private ContextMenu sysTrayMenu;

        private Process mongo;
        private Process meteor;

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Form1());
        }

        public Form1()
        {
            sysTrayMenu = new ContextMenu();
            sysTrayMenu.MenuItems.Add("Exit", OnExit); 
            sysTrayIcon = new NotifyIcon();
            sysTrayIcon.Text = "Stacks";
            sysTrayIcon.Icon = new Icon(SystemIcons.Shield, 40, 40);
            sysTrayIcon.ContextMenu = sysTrayMenu;
            sysTrayIcon.Visible = true;

            mongo = LaunchMongo();

            // Wait for TCP connectivity ...
            TcpClient tcpClient = new TcpClient();
            do { tcpClient.Connect("127.0.0.1", 24472); Thread.Sleep(1000); } while (!tcpClient.Connected);
            tcpClient.Close();

            meteor = LaunchMeteor();
        }

        protected override void OnLoad(EventArgs e)
        { 
            Visible = false;
            ShowInTaskbar = false;
            base.OnLoad(e);
        }

        private void OnExit(object sender, EventArgs e)
        {
            meteor.Kill();
            meteor.WaitForExit();

            mongo.Kill();
            mongo.WaitForExit();

            sysTrayIcon.Visible = false;
            Application.Exit();
        }

        static Process LaunchMongo()
        {
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.CreateNoWindow = true;
            startInfo.UseShellExecute = false;
            startInfo.FileName = "mongod.exe";
            startInfo.WindowStyle = ProcessWindowStyle.Hidden;
            //string dbDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "stacks");
            //startInfo.Arguments = "--quiet --port 24472 --dbpath " + dbDir;
            startInfo.Arguments = "--quiet --port 24472 --dbpath ..\\db";
            return Process.Start(startInfo);
        }

        static Process LaunchMeteor()
        {
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.CreateNoWindow = true;
            startInfo.UseShellExecute = false;
            startInfo.FileName = "..\\node\\node.exe";
            startInfo.WorkingDirectory = "..\\meteor";
            startInfo.WindowStyle = ProcessWindowStyle.Hidden;
            startInfo.EnvironmentVariables["MONGO_URL"] = "mongodb://127.0.0.1:24472";
            startInfo.EnvironmentVariables["ROOT_URL"] = "http://127.0.0.1:4472";
            startInfo.EnvironmentVariables["PORT"] = "4472";
            startInfo.Arguments = "main.js --scripts-prepend-node-path";
            return Process.Start(startInfo);
        }
    }
}
